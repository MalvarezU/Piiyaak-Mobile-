/**
 * Bloque quiz interactivo (paridad web `block-quiz.tsx`).
 *
 * Todas las preguntas a la vez; "Revisar" calcula el porcentaje y lo
 * compara con `passScore`. Si aprueba, dispara `onAprobado` una sola vez
 * (guarda con ref para no repetir en re-render) y muestra el estado de
 * éxito; si no, ofrece "Reintentar" con la ronda en blanco. El color es
 * señal (verde = acierto, rojo = error) y sale de los tokens del tema.
 */
import { useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { CheckCircle2, RotateCcw, XCircle } from "lucide-react-native";
import { theme, spacing, radiusScale, minHit } from "../theme";
import { Button, ThemedText } from "./ui";

export interface QuizOption {
  text: string;
  correct: boolean;
}

export interface QuizQuestion {
  prompt: string;
  options: QuizOption[];
  explanation?: string;
}

export interface QuizBlockProps {
  questions: QuizQuestion[];
  passScore: number;
  /** Se dispara una sola vez cuando el porcentaje alcanza `passScore`. */
  onAprobado?: (score: number) => void;
}

export function QuizBlock({ questions, passScore, onAprobado }: QuizBlockProps) {
  const [answers, setAnswers] = useState<(number | null)[]>(() =>
    questions.map(() => null),
  );
  const [submitted, setSubmitted] = useState(false);
  const firedRef = useRef(false);

  const total = questions.length;
  const score = answers.reduce((acc: number, ans, i) => {
    if (ans === null) return acc;
    const q = questions[i];
    if (!q) return acc;
    const opt = q.options[ans];
    return acc + (opt?.correct ? 1 : 0);
  }, 0);
  const pct = total > 0 ? Math.round((score / total) * 100) : 0;
  const passed = pct >= passScore;
  const allAnswered = answers.every((a) => a !== null);

  const revisar = () => {
    if (!allAnswered || submitted) return;
    setSubmitted(true);
    if (passed && !firedRef.current) {
      firedRef.current = true;
      onAprobado?.(pct);
    }
  };

  const reintentar = () => {
    setAnswers(questions.map(() => null));
    setSubmitted(false);
  };

  return (
    <View style={styles.wrap}>
      {questions.map((q, qi) => (
        <View key={qi} style={styles.question}>
          <ThemedText variant="bodyMedium" style={styles.prompt}>
            {`${qi + 1}. ${q.prompt}`}
          </ThemedText>
          <View
            accessibilityRole="radiogroup"
            accessibilityLabel={`Pregunta ${qi + 1}: ${q.prompt}`}
            style={styles.options}
          >
            {q.options.map((opt, oi) => {
              const selected = answers[qi] === oi;
              let backgroundColor: string = theme.card;
              let borderColor: string = selected ? theme.primary : theme.border;
              if (submitted) {
                if (opt.correct) {
                  backgroundColor = theme.successSoft;
                  borderColor = theme.success;
                } else if (selected) {
                  backgroundColor = theme.dangerSoft;
                  borderColor = theme.danger;
                }
              } else if (selected) {
                backgroundColor = theme.successSoft;
              }
              return (
                <Pressable
                  key={oi}
                  accessibilityRole="radio"
                  accessibilityLabel={`Opción ${oi + 1} de la pregunta ${qi + 1}`}
                  accessibilityState={{ checked: selected, disabled: submitted }}
                  disabled={submitted}
                  onPress={() => {
                    setAnswers((prev) => {
                      const next = [...prev];
                      next[qi] = oi;
                      return next;
                    });
                  }}
                  style={({ pressed }) => [
                    styles.option,
                    { backgroundColor, borderColor },
                    pressed && !submitted ? styles.pressed : null,
                  ]}
                >
                  <ThemedText variant="label" style={styles.optionText}>
                    {opt.text}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
          {submitted && q.explanation ? (
            <ThemedText variant="caption" style={styles.explanation}>
              {q.explanation}
            </ThemedText>
          ) : null}
        </View>
      ))}

      <View style={styles.footer}>
        {!submitted ? (
          <Button title="Revisar" onPress={revisar} disabled={!allAnswered} />
        ) : passed ? (
          <View style={styles.result} role="status">
            <CheckCircle2 size={18} color={theme.success} />
            <ThemedText variant="label" style={styles.resultOk}>
              {`Aprobado — ${pct}%`}
            </ThemedText>
          </View>
        ) : (
          <>
            <View style={styles.result} role="alert">
              <XCircle size={18} color={theme.danger} />
              <ThemedText variant="label" style={styles.resultBad}>
                {`No aprobado — ${pct}%`}
              </ThemedText>
            </View>
            <Button
              title="Reintentar"
              variant="secondary"
              icon={<RotateCcw size={18} color={theme.primary} />}
              onPress={reintentar}
            />
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  question: { gap: spacing.sm },
  prompt: { color: theme.text },
  options: { gap: spacing.sm },
  option: {
    minHeight: minHit,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.mid,
    borderRadius: radiusScale.sm,
    borderCurve: "continuous",
    borderWidth: 1,
    backgroundColor: theme.card,
  },
  pressed: { opacity: 0.92 },
  optionText: { color: theme.text },
  explanation: { color: theme.muted, marginTop: spacing.xs },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  result: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  resultOk: { color: theme.success },
  resultBad: { color: theme.danger },
});
