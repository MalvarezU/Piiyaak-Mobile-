import { useState } from "react";
import { Text, TouchableOpacity, View, StyleSheet } from "react-native";
import { theme } from "../theme";

interface QuizOption {
  text: string;
  correct: boolean;
}

interface QuizQuestion {
  prompt: string;
  options: QuizOption[];
  explanation?: string;
}

interface QuizBlockProps {
  questions: QuizQuestion[];
  passScore: number;
}

export function QuizBlock({ questions, passScore }: QuizBlockProps) {
  const [answers, setAnswers] = useState<(number | null)[]>(questions.map(() => null));
  const [submitted, setSubmitted] = useState(false);

  const score = answers.reduce((acc: number, ans, i) => {
    if (ans === null) return acc;
    const q = questions[i];
    if (!q) return acc;
    const opt = q.options[ans];
    return acc + (opt?.correct ? 1 : 0);
  }, 0);

  const pct = questions.length > 0 ? Math.round((score / questions.length) * 100) : 0;
  const passed = pct >= passScore;

  return (
    <View>
      {questions.map((q, qi) => (
        <View key={qi} style={styles.question}>
          <Text style={styles.prompt}>{q.prompt}</Text>
          {q.options.map((opt, oi) => {
            const selected = answers[qi] === oi;
            const showResult = submitted;
            let bg = theme.card as string;
            if (showResult) {
              if (opt.correct) bg = theme.successSoft;
              else if (selected) bg = theme.dangerSoft;
            } else if (selected) {
              bg = theme.primary + "20";
            }
            return (
              <TouchableOpacity
                key={oi}
                style={[styles.option, { backgroundColor: bg }]}
                onPress={() => {
                  if (submitted) return;
                  setAnswers((prev) => {
                    const next = [...prev];
                    next[qi] = oi;
                    return next;
                  });
                }}
                disabled={submitted}
              >
                <Text style={styles.optionText}>{opt.text}</Text>
              </TouchableOpacity>
            );
          })}
          {submitted && q.explanation ? <Text style={styles.explanation}>{q.explanation}</Text> : null}
        </View>
      ))}
      {!submitted ? (
        <TouchableOpacity
          style={styles.btn}
          onPress={() => setSubmitted(true)}
          disabled={answers.some((a) => a === null)}
        >
          <Text style={styles.btnText}>Comprobar</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.result}>
          <Text style={[styles.resultText, passed ? styles.ok : styles.bad]}>
            {passed ? "✓ Aprobado" : "✗ No aprobado"} — {pct}%
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  question: { marginBottom: 16 },
  prompt: { fontSize: 15, fontWeight: "600", marginBottom: 8 },
  option: { padding: 12, borderRadius: 8, borderWidth: 1, borderColor: theme.border, marginBottom: 6 },
  optionText: { fontSize: 14 },
  btn: { backgroundColor: theme.primary, borderRadius: 8, padding: 12, alignItems: "center", marginTop: 8 },
  btnText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  result: { marginTop: 12, alignItems: "center" },
  resultText: { fontSize: 16, fontWeight: "600" },
  ok: { color: theme.success },
  bad: { color: theme.danger },
  explanation: { fontSize: 13, color: theme.muted, marginTop: 4, fontStyle: "italic" },
});