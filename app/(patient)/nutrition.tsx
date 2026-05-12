import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  FlatList, Platform, useColorScheme,
  KeyboardAvoidingView, ActivityIndicator, TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/colors';
import { getApiUrl } from '@/lib/query-client';
import { fetch as expoFetch } from 'expo/fetch';
import { useAuth } from '@/context/AuthContext';

const WEB = Platform.OS === 'web';
const TODAY = new Date().toISOString().split('T')[0];

type MealPlanItem = {
  id: string;
  mealType: string;
  foodName: string;
  scheduledTime: string;
  calories: number;
  notes?: string;
  careGiverName: string;
};

type ChatMessage = { role: 'user' | 'assistant'; content: string };

const MEAL_META: Record<string, { icon: string; color: string; label: string }> = {
  breakfast: { icon: 'sunny-outline', color: '#F59E0B', label: 'Breakfast' },
  lunch: { icon: 'partly-sunny-outline', color: '#10B981', label: 'Lunch' },
  dinner: { icon: 'moon-outline', color: '#8B5CF6', label: 'Dinner' },
  snack: { icon: 'nutrition-outline', color: '#3B82F6', label: 'Snack' },
};

export default function NutritionScreen() {
  const isDark = useColorScheme() === 'dark';
  const C = isDark ? Colors.dark : Colors.light;
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { authHeader, user } = useAuth();

  const [tab, setTab] = useState<'meals' | 'ai'>('meals');

  const [mealPlans, setMealPlans] = useState<MealPlanItem[]>([]);
  const [confirmed, setConfirmed] = useState<string[]>([]);
  const [loadingMeals, setLoadingMeals] = useState(true);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const [goals, setGoals] = useState({ calories: 2000, protein: 120, carbs: 250, fat: 65, water: 8, doctorNote: '' });
  const [glasses, setGlasses] = useState(0);

  const [aiMessages, setAiMessages] = useState<ChatMessage[]>([]);
  const [aiInput, setAiInput] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [streaming, setStreaming] = useState('');
  const flatRef = useRef<FlatList>(null);

  const base = getApiUrl();

  async function loadData() {
    try {
      const h = authHeader();
      const [mealRes, goalsRes, waterRes] = await Promise.all([
        expoFetch(`${base}api/patient/meal-plan`, { headers: h }),
        expoFetch(`${base}api/nutrition/goals`, { headers: h }),
        expoFetch(`${base}api/nutrition/water?date=${TODAY}`, { headers: h }),
      ]);
      const mealData = await mealRes.json();
      const goalsData = await goalsRes.json();
      const waterData = await waterRes.json();
      if (mealData.meals) setMealPlans(mealData.meals);
      if (mealData.confirmed) setConfirmed(mealData.confirmed);
      if (goalsData.goals) setGoals(goalsData.goals);
      if (waterData.glasses !== undefined) setGlasses(waterData.glasses);
    } catch {}
    setLoadingMeals(false);
  }

  useEffect(() => { if (user) loadData(); }, [user]);

  async function toggleMealConfirm(mealId: string) {
    const isConfirmed = confirmed.includes(mealId);
    setConfirmingId(mealId);
    try {
      if (isConfirmed) {
        await expoFetch(`${base}api/patient/meal-plan/${mealId}/confirm`, {
          method: 'DELETE',
          headers: authHeader(),
        });
        setConfirmed(prev => prev.filter(id => id !== mealId));
      } else {
        await expoFetch(`${base}api/patient/meal-plan/${mealId}/confirm`, {
          method: 'POST',
          headers: authHeader(),
        });
        setConfirmed(prev => [...prev, mealId]);
      }
    } catch {}
    setConfirmingId(null);
  }

  async function updateWater(g: number) {
    const next = Math.max(0, Math.min(g, 12));
    setGlasses(next);
    try {
      await expoFetch(`${base}api/nutrition/water`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ glasses: next, date: TODAY }),
      });
    } catch {}
  }

  const sendAiMessage = async (text: string) => {
    if (!text.trim() || aiLoading) return;
    const userMsg: ChatMessage = { role: 'user', content: text.trim() };
    const newMessages = [...aiMessages, userMsg];
    setAiMessages(newMessages);
    setAiInput('');
    setAiLoading(true);
    setStreaming('');

    const confirmedCount = confirmed.length;
    const totalMeals = mealPlans.length;
    const context = { mealPlan: mealPlans.map(m => ({ meal: m.mealType, food: m.foodName, time: m.scheduledTime, cal: m.calories })), confirmedToday: confirmedCount, totalMeals, goals };

    try {
      const url = new URL('/api/nutrition/ai-chat', getApiUrl());
      const resp = await expoFetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream', ...authHeader() },
        body: JSON.stringify({ messages: newMessages.map(m => ({ role: m.role, content: m.content })), context }),
      });

      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let full = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (payload === '[DONE]') break;
          try { const p = JSON.parse(payload); if (p.content) { full += p.content; setStreaming(full); } } catch {}
        }
      }
      setAiMessages(prev => [...prev, { role: 'assistant', content: full }]);
      setStreaming('');
    } catch {
      setAiMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, I had trouble connecting. Please try again.' }]);
    }
    setAiLoading(false);
  };

  const SUGGESTED = ['Am I eating well today?', 'What nutrients am I getting from my meals?', 'Any tips for my meal plan?'];
  const topPad = WEB ? 67 : insets.top;
  const botPad = WEB ? 84 : insets.bottom + 50;

  const confirmedCount = confirmed.length;
  const totalCal = mealPlans.filter(m => confirmed.includes(m.id)).reduce((s, m) => s + m.calories, 0);
  const allDone = mealPlans.length > 0 && confirmedCount === mealPlans.length;

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 12, backgroundColor: C.bg, borderBottomColor: C.divider }]}>
        <View>
          <Text style={[styles.headerSub, { color: C.textMuted }]}>{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</Text>
          <Text style={[styles.headerTitle, { color: C.text }]}>Nutrition</Text>
        </View>
        <View style={styles.tabSwitcher}>
          {(['meals', 'ai'] as const).map(t => (
            <TouchableOpacity key={t} onPress={() => setTab(t)} style={[styles.tabBtn, tab === t && { backgroundColor: Colors.primary + '25' }]}>
              <Ionicons name={t === 'meals' ? 'restaurant-outline' : 'chatbubble-ellipses-outline'} size={18} color={tab === t ? Colors.primary : C.textMuted} />
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* MEALS TAB */}
      {tab === 'meals' && (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: botPad + 20 }} showsVerticalScrollIndicator={false}>

          {/* Progress summary bar */}
          {mealPlans.length > 0 && (
            <View style={[styles.summaryCard, { backgroundColor: allDone ? '#10B98115' : Colors.primary + '12', borderColor: allDone ? '#10B98130' : Colors.primary + '30', margin: 16, marginBottom: 8 }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={[styles.summaryIcon, { backgroundColor: allDone ? '#10B98125' : Colors.primary + '25' }]}>
                  <Ionicons name={allDone ? 'checkmark-circle' : 'restaurant'} size={22} color={allDone ? '#10B981' : Colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.summaryTitle, { color: C.text }]}>
                    {allDone ? 'All meals completed!' : `${confirmedCount} of ${mealPlans.length} meals done`}
                  </Text>
                  {totalCal > 0 && (
                    <Text style={[styles.summarySub, { color: C.textMuted }]}>{totalCal} kcal consumed today</Text>
                  )}
                </View>
                <Text style={[styles.summaryPct, { color: allDone ? '#10B981' : Colors.primary }]}>
                  {Math.round((confirmedCount / mealPlans.length) * 100)}%
                </Text>
              </View>
              <View style={[styles.progressTrack, { backgroundColor: C.divider, marginTop: 10 }]}>
                <View style={[styles.progressFill, { width: `${(confirmedCount / mealPlans.length) * 100}%` as any, backgroundColor: allDone ? '#10B981' : Colors.primary }]} />
              </View>
            </View>
          )}

          {/* Meal list */}
          <View style={{ paddingHorizontal: 16 }}>
            <View style={styles.sectionHeaderRow}>
              <Text style={[styles.sectionTitle, { color: C.text }]}>Today's Approved Meals</Text>
              <View style={[styles.careGiverBadge, { backgroundColor: '#8B5CF615', borderColor: '#8B5CF630' }]}>
                <Ionicons name="medkit-outline" size={11} color="#8B5CF6" />
                <Text style={[styles.careGiverBadgeText, { color: '#8B5CF6' }]}>Care Giver Plan</Text>
              </View>
            </View>

            {loadingMeals ? (
              <View style={styles.emptyState}>
                <ActivityIndicator color={Colors.primary} />
              </View>
            ) : mealPlans.length === 0 ? (
              <View style={styles.emptyState}>
                <View style={[styles.emptyIcon, { backgroundColor: Colors.primary + '15' }]}>
                  <Ionicons name="restaurant-outline" size={36} color={Colors.primary} />
                </View>
                <Text style={[styles.emptyTitle, { color: C.text }]}>No Meal Plan Yet</Text>
                <Text style={[styles.emptySub, { color: C.textMuted }]}>Your care giver hasn't set up your meal plan yet. Check back later.</Text>
              </View>
            ) : (
              mealPlans.map(meal => {
                const meta = MEAL_META[meal.mealType] || MEAL_META.snack;
                const isDone = confirmed.includes(meal.id);
                const isConfirming = confirmingId === meal.id;
                return (
                  <View key={meal.id} style={[styles.mealCard, { backgroundColor: isDone ? meta.color + '0D' : C.card, borderColor: isDone ? meta.color + '40' : C.divider }]}>
                    <View style={styles.mealCardRow}>
                      <View style={[styles.mealIcon, { backgroundColor: meta.color + '20' }]}>
                        <Ionicons name={meta.icon as any} size={20} color={meta.color} />
                      </View>
                      <View style={{ flex: 1, gap: 3 }}>
                        <Text style={[styles.mealName, { color: isDone ? C.textMuted : C.text, textDecorationLine: isDone ? 'line-through' : 'none' }]}>{meal.foodName}</Text>
                        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                          <Text style={[styles.mealType, { color: meta.color }]}>{meta.label}</Text>
                          <View style={[styles.timeTag, { backgroundColor: meta.color + '18' }]}>
                            <Ionicons name="alarm-outline" size={11} color={meta.color} />
                            <Text style={[styles.timeTagText, { color: meta.color }]}>{meal.scheduledTime}</Text>
                          </View>
                          {meal.calories > 0 && (
                            <Text style={[styles.calTag, { color: C.textMuted }]}>{meal.calories} kcal</Text>
                          )}
                        </View>
                        {meal.notes ? <Text style={[styles.mealNotes, { color: C.textMuted }]}>{meal.notes}</Text> : null}
                      </View>
                      <TouchableOpacity
                        onPress={() => toggleMealConfirm(meal.id)}
                        disabled={isConfirming}
                        style={[styles.checkBtn, { backgroundColor: isDone ? '#10B981' : C.card, borderColor: isDone ? '#10B981' : C.divider }]}
                      >
                        {isConfirming ? (
                          <ActivityIndicator size="small" color={isDone ? '#fff' : Colors.primary} />
                        ) : (
                          <Ionicons name={isDone ? 'checkmark' : 'checkmark-outline'} size={20} color={isDone ? '#fff' : C.textMuted} />
                        )}
                      </TouchableOpacity>
                    </View>
                    {isDone && (
                      <View style={[styles.doneBanner, { backgroundColor: '#10B98115' }]}>
                        <Ionicons name="checkmark-circle" size={13} color="#10B981" />
                        <Text style={[styles.doneBannerText, { color: '#10B981' }]}>Marked as eaten</Text>
                      </View>
                    )}
                  </View>
                );
              })
            )}
          </View>

          {/* Water intake */}
          <View style={[styles.card, { backgroundColor: C.card, borderColor: C.divider, margin: 16, marginTop: 12 }]}>
            <View style={styles.waterHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="water-outline" size={18} color={Colors.primary} />
                <Text style={[styles.sectionTitle, { color: C.text, margin: 0 }]}>Water Intake</Text>
              </View>
              <Text style={[styles.waterCount, { color: Colors.primary }]}>{glasses} / {goals.water} glasses</Text>
            </View>
            <View style={styles.waterDrops}>
              {Array.from({ length: goals.water }).map((_, i) => (
                <TouchableOpacity key={i} onPress={() => updateWater(i < glasses ? i : i + 1)}>
                  <View style={[styles.drop, { backgroundColor: i < glasses ? Colors.primary + '25' : C.divider, borderColor: i < glasses ? Colors.primary : 'transparent' }]}>
                    <Ionicons name="water" size={16} color={i < glasses ? Colors.primary : C.textMuted} />
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Care giver note */}
          {goals.doctorNote ? (
            <View style={[styles.noteCard, { backgroundColor: '#8B5CF615', borderColor: '#8B5CF630', marginHorizontal: 16 }]}>
              <Ionicons name="medkit-outline" size={18} color="#8B5CF6" />
              <View style={{ flex: 1 }}>
                <Text style={[styles.noteTitle, { color: '#8B5CF6' }]}>Care Giver's Note</Text>
                <Text style={[styles.noteText, { color: C.textMuted }]}>{goals.doctorNote}</Text>
              </View>
            </View>
          ) : null}
        </ScrollView>
      )}

      {/* AI COACH TAB */}
      {tab === 'ai' && (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={topPad + 60}>
          <FlatList
            ref={flatRef}
            data={[...aiMessages, ...(streaming ? [{ role: 'assistant' as const, content: streaming }] : [])]}
            keyExtractor={(_, i) => String(i)}
            inverted
            contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'column-reverse' }}
            ListFooterComponent={
              aiMessages.length === 0 ? (
                <View style={styles.aiWelcome}>
                  <View style={[styles.aiWelcomeIcon, { backgroundColor: Colors.primary + '20' }]}>
                    <Ionicons name="nutrition" size={32} color={Colors.primary} />
                  </View>
                  <Text style={[styles.aiWelcomeTitle, { color: C.text }]}>AI Nutrition Coach</Text>
                  <Text style={[styles.aiWelcomeSub, { color: C.textMuted }]}>I know your approved meal plan and goals from your care giver. Ask me anything about your nutrition.</Text>
                  <View style={{ width: '100%', gap: 8, marginTop: 16 }}>
                    {SUGGESTED.map((q, i) => (
                      <TouchableOpacity key={i} onPress={() => sendAiMessage(q)} style={[styles.suggChip, { backgroundColor: C.card, borderColor: C.divider }]}>
                        <Text style={[styles.suggText, { color: C.text }]}>{q}</Text>
                        <Ionicons name="arrow-forward" size={14} color={C.textMuted} />
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              ) : null
            }
            renderItem={({ item }) => (
              <View style={[styles.bubble, item.role === 'user' ? styles.userBubble : [styles.aiBubble, { backgroundColor: C.card, borderColor: C.divider }]]}>
                {item.role === 'assistant' && (
                  <View style={[styles.aiAvatar, { backgroundColor: Colors.primary + '20' }]}>
                    <Ionicons name="nutrition" size={14} color={Colors.primary} />
                  </View>
                )}
                <View style={[styles.bubbleInner, item.role === 'user' && { backgroundColor: Colors.primary + '25', borderColor: Colors.primary + '40', borderWidth: 1 }]}>
                  <Text style={[styles.bubbleText, { color: C.text }]}>{item.content}</Text>
                </View>
              </View>
            )}
          />
          {aiLoading && !streaming && (
            <View style={[styles.typingRow, { paddingHorizontal: 16 }]}>
              <ActivityIndicator size="small" color={Colors.primary} />
              <Text style={[styles.typingText, { color: C.textMuted }]}>Thinking…</Text>
            </View>
          )}
          <View style={[styles.aiInputBar, { borderTopColor: C.divider, backgroundColor: C.bg, paddingBottom: botPad }]}>
            <View style={[styles.aiInputWrap, { backgroundColor: C.card, borderColor: Colors.primary + '50' }]}>
              <TextInput
                style={[styles.aiInput, { color: C.text }]}
                placeholder="Ask about your nutrition..."
                placeholderTextColor={C.textMuted}
                value={aiInput}
                onChangeText={setAiInput}
                onSubmitEditing={() => sendAiMessage(aiInput)}
                returnKeyType="send"
                multiline
              />
              <TouchableOpacity onPress={() => sendAiMessage(aiInput)} disabled={aiLoading || !aiInput.trim()} style={[styles.sendBtn, { backgroundColor: Colors.primary, opacity: aiLoading || !aiInput.trim() ? 0.5 : 1 }]}>
                <Ionicons name="send" size={16} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 1, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  headerSub: { fontSize: 12, marginBottom: 2 },
  headerTitle: { fontSize: 26, fontWeight: '700', letterSpacing: -0.5 },
  tabSwitcher: { flexDirection: 'row', gap: 6 },
  tabBtn: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },

  summaryCard: { borderRadius: 16, borderWidth: 1, padding: 16 },
  summaryIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  summaryTitle: { fontSize: 15, fontWeight: '600' },
  summarySub: { fontSize: 12, marginTop: 2 },
  summaryPct: { fontSize: 20, fontWeight: '700' },
  progressTrack: { height: 6, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 3 },

  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  sectionTitle: { fontSize: 15, fontWeight: '600' },
  careGiverBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, borderWidth: 1 },
  careGiverBadgeText: { fontSize: 10, fontWeight: '600' },

  emptyState: { alignItems: 'center', paddingVertical: 48, gap: 12 },
  emptyIcon: { width: 72, height: 72, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontSize: 17, fontWeight: '600' },
  emptySub: { fontSize: 13, textAlign: 'center', maxWidth: 260, lineHeight: 19 },

  mealCard: { borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 10, gap: 8 },
  mealCardRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  mealIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  mealName: { fontSize: 15, fontWeight: '600' },
  mealType: { fontSize: 12, fontWeight: '500' },
  timeTag: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 7 },
  timeTagText: { fontSize: 11, fontWeight: '600' },
  calTag: { fontSize: 11 },
  mealNotes: { fontSize: 12, fontStyle: 'italic', marginTop: 2 },
  checkBtn: { width: 40, height: 40, borderRadius: 12, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  doneBanner: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  doneBannerText: { fontSize: 12, fontWeight: '500' },

  card: { borderRadius: 16, borderWidth: 1, padding: 16 },
  waterHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  waterCount: { fontSize: 14, fontWeight: '600' },
  waterDrops: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  drop: { width: 36, height: 36, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },

  noteCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 14, borderRadius: 14, borderWidth: 1 },
  noteTitle: { fontSize: 13, fontWeight: '600', marginBottom: 3 },
  noteText: { fontSize: 13, lineHeight: 19 },

  aiWelcome: { alignItems: 'center', paddingVertical: 32, gap: 8 },
  aiWelcomeIcon: { width: 64, height: 64, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  aiWelcomeTitle: { fontSize: 20, fontWeight: '700' },
  aiWelcomeSub: { fontSize: 14, textAlign: 'center', maxWidth: 280, lineHeight: 20 },
  suggChip: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14, borderRadius: 12, borderWidth: 1 },
  suggText: { fontSize: 14, flex: 1, marginRight: 8 },
  bubble: { marginBottom: 12 },
  userBubble: { alignItems: 'flex-end' },
  aiBubble: { alignItems: 'flex-start', flexDirection: 'row', gap: 8 },
  aiAvatar: { width: 28, height: 28, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  bubbleInner: { maxWidth: '80%', padding: 12, borderRadius: 14 },
  bubbleText: { fontSize: 14, lineHeight: 20 },
  typingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  typingText: { fontSize: 13 },
  aiInputBar: { borderTopWidth: 1, padding: 12 },
  aiInputWrap: { flexDirection: 'row', alignItems: 'flex-end', borderRadius: 14, borderWidth: 1.5, paddingLeft: 14, paddingRight: 6, paddingVertical: 6, gap: 8 },
  aiInput: { flex: 1, fontSize: 15, maxHeight: 100, paddingVertical: 6 },
  sendBtn: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});
