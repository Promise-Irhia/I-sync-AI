import React, { useState, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, ScrollView, TextInput, Pressable, useColorScheme,
  Platform, ActivityIndicator, useWindowDimensions, KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { fetch } from 'expo/fetch';
import { useAuth } from '@/context/AuthContext';
import { Colors } from '@/constants/colors';
import { getApiUrl } from '@/lib/query-client';

type Message = { id: string; role: 'user' | 'assistant'; content: string };

let msgCounter = 0;
function uniqueId() {
  msgCounter++;
  return `doc-msg-${Date.now()}-${msgCounter}`;
}

const QUICK_PROMPTS = [
  { icon: 'git-branch-outline', text: 'Differential diagnosis for chest pain' },
  { icon: 'flask-outline', text: 'Drug interactions for metformin & lisinopril' },
  { icon: 'analytics-outline', text: 'Interpret elevated troponin levels' },
  { icon: 'document-text-outline', text: 'Hypertension management guidelines' },
  { icon: 'people-outline', text: 'Sepsis bundle management' },
  { icon: 'shield-outline', text: 'CHADS2 score for atrial fibrillation' },
];

export default function DoctorAssistant() {
  const insets = useSafeAreaInsets();
  const isDark = useColorScheme() === 'dark';
  const C = isDark ? Colors.dark : Colors.light;
  const { authHeader, handleUnauthorized } = useAuth();
  const inputRef = useRef<TextInput>(null);
  const { width, height } = useWindowDimensions();

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [showTyping, setShowTyping] = useState(false);

  const WEB = Platform.OS === 'web';
  const isWide = WEB && width > 600;
  const topPad = WEB ? 67 : insets.top;
  const botPad = WEB ? 84 : insets.bottom;
  const maxW = 600;
  const webC: any = WEB ? { maxWidth: maxW, width: '100%', alignSelf: 'center' as const } : {};

  async function sendMessage(text: string) {
    if (!text.trim() || isSending) return;
    const currentMessages = [...messages];
    const userMsg: Message = { id: uniqueId(), role: 'user', content: text.trim() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsSending(true);
    setShowTyping(true);

    try {
      const base = getApiUrl();
      const chatHistory = [
        ...currentMessages.map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: text.trim() },
      ];
      const response = await fetch(`${base}api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream', ...authHeader() },
        body: JSON.stringify({ messages: chatHistory, mode: 'doctor' }),
      });
      if (response.status === 401) { await handleUnauthorized(); return; }
      if (!response.ok) throw new Error('Failed');
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No body');
      const decoder = new TextDecoder();
      let buffer = '';
      let fullContent = '';
      let assistantAdded = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.content) {
              fullContent += parsed.content;
              if (!assistantAdded) {
                setShowTyping(false);
                setMessages(prev => [...prev, { id: uniqueId(), role: 'assistant', content: fullContent }]);
                assistantAdded = true;
              } else {
                setMessages(prev => {
                  const updated = [...prev];
                  updated[updated.length - 1] = { ...updated[updated.length - 1], content: fullContent };
                  return updated;
                });
              }
            }
          } catch {}
        }
      }
    } catch {
      setShowTyping(false);
      setMessages(prev => [...prev, { id: uniqueId(), role: 'assistant', content: 'AI service error. Please try again.' }]);
    } finally {
      setIsSending(false);
      setShowTyping(false);
    }
  }

  const reversed = [...messages].reverse();

  return (
    <View style={[styles.container, { backgroundColor: C.bg }]}>
      {/* Header — outside KeyboardAvoidingView so it stays fixed when keyboard opens */}
      <View style={[styles.headerOuter, { paddingTop: topPad + 12, borderBottomColor: C.divider, backgroundColor: C.bg }]}>
        <View style={[styles.headerInner, webC]}>
          <View style={styles.headerLeft}>
            <View style={[styles.aiAvatar, { backgroundColor: Colors.purple + '20' }]}>
              <Ionicons name="flask" size={20} color={Colors.purple} />
            </View>
            <View>
              <Text style={[styles.headerTitle, { color: C.text, fontFamily: 'Inter_700Bold' }]}>Clinical AI</Text>
              <View style={styles.onlineDot}>
                <View style={[styles.dot, { backgroundColor: Colors.purple }]} />
                <Text style={[styles.headerSub, { color: Colors.purple, fontFamily: 'Inter_500Medium' }]}>Medical Decision Support</Text>
              </View>
            </View>
          </View>
          {messages.length > 0 && (
            <Pressable
              style={[styles.clearBtn, { backgroundColor: C.card, borderColor: C.cardBorder }]}
              onPress={() => setMessages([])}
            >
              <Ionicons name="create-outline" size={16} color={C.textSub} />
              <Text style={[styles.clearText, { color: C.textSub, fontFamily: 'Inter_500Medium' }]}>New</Text>
            </Pressable>
          )}
        </View>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={0}>
        {/* Welcome OR Messages — mutually exclusive so flex:1 isn't split */}
        {messages.length === 0 ? (
          <ScrollView
            style={{ flex: 1, minHeight: height * 0.5 }}
            contentContainerStyle={[styles.welcomeOuter, WEB && { alignItems: 'center' }]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <View style={[styles.welcomeInner, webC, WEB && { paddingTop: 80 }]}>
              <View style={[styles.welcomeIcon, { backgroundColor: Colors.purple + '30' }]}>
                <Ionicons name="flask" size={40} color={Colors.purple} />
              </View>
              <Text style={[styles.welcomeTitle, { color: C.text, fontFamily: 'Inter_700Bold' }]}>
                Clinical AI Assistant
              </Text>
              <Text style={[styles.welcomeSub, { color: C.textSub, fontFamily: 'Inter_400Regular' }]}>
                Evidence-based support for diagnosis, drug interactions, and treatment decisions.
              </Text>
              <View style={[styles.advisoryBox, { backgroundColor: Colors.warning + '15', borderColor: Colors.warning + '35' }]}>
                <Ionicons name="information-circle" size={15} color={Colors.warning} />
                <Text style={[styles.advisoryText, { color: Colors.warning, fontFamily: 'Inter_400Regular' }]}>
                  AI is advisory only — clinical judgment must always prevail
                </Text>
              </View>
              <View style={[styles.promptGrid, isWide && styles.promptGridWide]}>
                {QUICK_PROMPTS.map((q, i) => (
                  <Pressable
                    key={i}
                    style={({ pressed }) => [
                      styles.quickBtn,
                      { backgroundColor: C.card, borderColor: C.cardBorder, opacity: pressed ? 0.75 : 1 },
                      isWide && styles.quickBtnWide,
                    ]}
                    onPress={() => sendMessage(q.text)}
                  >
                    <Ionicons name={q.icon as any} size={15} color={Colors.purple} />
                    <Text style={[styles.quickText, { color: C.text, fontFamily: 'Inter_400Regular' }]}>{q.text}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </ScrollView>
        ) : (
          <View style={[{ flex: 1 }, WEB && { alignItems: 'center' }]}>
            <View style={[{ flex: 1 }, WEB && { width: '100%', maxWidth: maxW }]}>
              <FlatList
                data={reversed}
                keyExtractor={item => item.id}
                inverted
                renderItem={({ item }) => <MessageBubble message={item} C={C} isDark={isDark} />}
                ListHeaderComponent={showTyping ? <TypingIndicator C={C} /> : null}
                keyboardDismissMode="interactive"
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 8 }}
                showsVerticalScrollIndicator={false}
              />
            </View>
          </View>
        )}

        {/* Input */}
        <View style={[styles.inputOuter, { borderTopColor: C.divider, paddingBottom: botPad + 8, backgroundColor: C.bg }, WEB && { alignItems: 'center' }]}>
          <View style={[webC]}>
            <View style={[styles.inputRow, { backgroundColor: C.card, borderColor: Colors.purple + '70' }]}>
              <TextInput
                ref={inputRef}
                style={[styles.textInput, { color: C.text, fontFamily: 'Inter_400Regular' }]}
                value={input}
                onChangeText={setInput}
                placeholder="Enter clinical query..."
                placeholderTextColor={C.textMuted}
                multiline
                maxLength={3000}
                blurOnSubmit={false}
                onSubmitEditing={() => { if (Platform.OS === 'web') { sendMessage(input); } }}
              />
              <Pressable
                style={[styles.sendBtn, { backgroundColor: input.trim() && !isSending ? Colors.purple : C.cardBorder }]}
                onPress={() => { sendMessage(input); inputRef.current?.focus(); }}
                disabled={!input.trim() || isSending}
              >
                {isSending
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Ionicons name="arrow-up" size={18} color={input.trim() ? '#fff' : C.textMuted} />
                }
              </Pressable>
            </View>
            <Text style={[styles.disclaimerText, { color: C.textMuted, fontFamily: 'Inter_400Regular' }]}>
              AI advisory only · Clinical judgment and patient context must prevail
            </Text>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function MessageBubble({ message, C, isDark }: { message: Message; C: any; isDark: boolean }) {
  const isUser = message.role === 'user';
  const lines = message.content.split('\n').filter((l, i, arr) => !(l.trim() === '' && arr[i - 1]?.trim() === ''));
  return (
    <View style={[styles.bubbleRow, isUser && styles.bubbleRowUser]}>
      {!isUser && (
        <View style={[styles.aiBubbleAvatar, { backgroundColor: Colors.purple + '20' }]}>
          <Ionicons name="flask" size={13} color={Colors.purple} />
        </View>
      )}
      <View style={[
        styles.bubble,
        isUser
          ? [styles.userBubble, { backgroundColor: Colors.purple }]
          : [styles.aiBubble, { backgroundColor: isDark ? '#1e1e2e' : '#fff', borderColor: C.cardBorder }],
        { maxWidth: '84%' },
      ]}>
        {lines.map((line, i) => {
          const isBullet = line.trim().startsWith('- ') || line.trim().startsWith('• ');
          const isHeader = line.trim().startsWith('**') && line.trim().endsWith('**');
          const cleaned = isHeader
            ? line.trim().replace(/\*\*/g, '')
            : isBullet
            ? line.trim().replace(/^[-•]\s*/, '')
            : line;
          return (
            <View key={i} style={isBullet ? styles.bulletRow : undefined}>
              {isBullet && <Text style={[styles.bulletDot, { color: isUser ? '#ffffff99' : Colors.purple }]}>•</Text>}
              <Text style={[
                styles.bubbleText,
                { color: isUser ? '#fff' : C.text, fontFamily: isHeader ? 'Inter_600SemiBold' : 'Inter_400Regular' },
                isHeader && { marginTop: i > 0 ? 6 : 0 },
              ]}>
                {cleaned}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function TypingIndicator({ C }: { C: any }) {
  return (
    <View style={styles.bubbleRow}>
      <View style={[styles.aiBubbleAvatar, { backgroundColor: Colors.purple + '20' }]}>
        <Ionicons name="flask" size={13} color={Colors.purple} />
      </View>
      <View style={[styles.bubble, styles.aiBubble, { backgroundColor: C.card, borderColor: C.cardBorder, paddingHorizontal: 16, paddingVertical: 14 }]}>
        <View style={styles.typingDots}>
          <View style={[styles.typingDot, { backgroundColor: Colors.purple }]} />
          <View style={[styles.typingDot, { backgroundColor: Colors.purple, opacity: 0.6 }]} />
          <View style={[styles.typingDot, { backgroundColor: Colors.purple, opacity: 0.3 }]} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerOuter: { paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  headerInner: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  aiAvatar: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, letterSpacing: -0.2 },
  onlineDot: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  headerSub: { fontSize: 12 },
  clearBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, borderWidth: 1 },
  clearText: { fontSize: 13 },
  welcomeOuter: { flexGrow: 1, paddingHorizontal: 20, justifyContent: 'center', paddingVertical: 24 },
  welcomeInner: { alignItems: 'center', gap: 14, paddingVertical: 24 },
  welcomeIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  welcomeTitle: { fontSize: 22, textAlign: 'center', letterSpacing: -0.4 },
  welcomeSub: { fontSize: 14, textAlign: 'center', lineHeight: 22, maxWidth: 340 },
  advisoryBox: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, borderWidth: 1, width: '100%' },
  advisoryText: { flex: 1, fontSize: 12, lineHeight: 18 },
  promptGrid: { width: '100%', gap: 8 },
  promptGridWide: { flexDirection: 'row', flexWrap: 'wrap' },
  quickBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 12, padding: 14, borderWidth: 1 },
  quickBtnWide: { width: '48%' },
  quickText: { fontSize: 13, lineHeight: 19, flex: 1 },
  bubbleRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  bubbleRowUser: { justifyContent: 'flex-end' },
  aiBubbleAvatar: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: 2, flexShrink: 0 },
  bubble: { borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10, gap: 3 },
  userBubble: { borderBottomRightRadius: 4 },
  aiBubble: { borderWidth: StyleSheet.hairlineWidth, borderBottomLeftRadius: 4 },
  bulletRow: { flexDirection: 'row', gap: 6, alignItems: 'flex-start' },
  bulletDot: { fontSize: 15, lineHeight: 22, marginTop: 1 },
  bubbleText: { fontSize: 15, lineHeight: 22, flexShrink: 1 },
  typingDots: { flexDirection: 'row', gap: 5, alignItems: 'center' },
  typingDot: { width: 8, height: 8, borderRadius: 4 },
  inputOuter: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingTop: 12, gap: 6 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', borderRadius: 22, borderWidth: 1.5, paddingLeft: 16, paddingRight: 6, paddingVertical: 6, gap: 8 },
  textInput: { flex: 1, fontSize: 15, maxHeight: 120, paddingTop: 6, paddingBottom: 6 },
  sendBtn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', marginBottom: 1 },
  disclaimerText: { fontSize: 11, textAlign: 'center', marginTop: 2 },
});
