/**
 * Ejercicio de escucha interactivo (paridad web `block-listening.tsx`).
 *
 * Reproduce el audio del ejercicio (resuelto por media-cache con
 * `audioKey`), muestra la pregunta y las opciones tipo radio. Acertar
 * dispara `onAprobado(100)` una sola vez (guarda con ref); errar marca la
 * opción elegida en rojo y permite reintentar. Sin `mediaUrl` avisa que el
 * audio no tiene fuente y el ejercicio sigue respondible.
 */
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { CheckCircle2, RotateCcw, Volume2 } from "lucide-react-native";
import { theme, spacing, radiusScale, minHit } from "../theme";
import { resolveCachedUri } from "../db/media-fs";
import { createAudioPlayer, type AudioPlayer } from "../audio-player";
import { Button, ThemedText } from "./ui";

export interface ListeningOption {
  text: string;
  correct: boolean;
}

export interface ListeningBlockProps {
  question: string;
  options: ListeningOption[];
  /** Fuente del audio; `null` = el ejercicio no tiene audio cargado. */
  mediaUrl: string | null;
  /** Id de lección: clave del media-cache (`lesson:<audioKey>`). */
  audioKey: string;
  /** Se dispara una sola vez cuando la opción elegida es la correcta. */
  onAprobado?: (score: number) => void;
}

type Estado = "jugando" | "aprobado" | "error";

export function ListeningBlock({
  question,
  options,
  mediaUrl,
  audioKey,
  onAprobado,
}: ListeningBlockProps) {
  const [elegida, setElegida] = useState<number | null>(null);
  const [estado, setEstado] = useState<Estado>("jugando");
  const [audioUri, setAudioUri] = useState<string | null>(mediaUrl);
  const firedRef = useRef(false);

  useEffect(() => {
    let alive = true;
    if (!mediaUrl) {
      setAudioUri(null);
      return;
    }
    setAudioUri(mediaUrl);
    resolveCachedUri({
      wordId: `lesson:${audioKey}`,
      kind: "audio",
      url: mediaUrl,
      sha256: null,
    })
      .then((uri) => {
        if (alive) setAudioUri(uri);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [audioKey, mediaUrl]);

  const elegir = (index: number) => {
    setElegida(index);
    setEstado("jugando");
  };

  const revisar = () => {
    if (elegida === null || estado === "aprobado") return;
    if (options[elegida]?.correct) {
      setEstado("aprobado");
      if (!firedRef.current) {
        firedRef.current = true;
        onAprobado?.(100);
      }
    } else {
      setEstado("error");
    }
  };

  return (
    <View style={styles.wrap}>
      {audioUri ? (
        <AudioButton key={audioUri} url={audioUri} />
      ) : (
        <ThemedText variant="label" style={styles.noSource}>
          El audio del ejercicio no tiene fuente.
        </ThemedText>
      )}

      <ThemedText variant="body" style={styles.question}>
        {question}
      </ThemedText>

      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={`Pregunta de escucha: ${question}`}
        style={styles.options}
      >
        {options.map((opt, i) => {
          const seleccionada = elegida === i;
          const enRevision = estado !== "jugando";
          let backgroundColor: string = theme.card;
          let borderColor: string = seleccionada ? theme.primary : theme.border;
          if (enRevision) {
            if (opt.correct) {
              backgroundColor = theme.successSoft;
              borderColor = theme.success;
            } else if (seleccionada) {
              backgroundColor = theme.dangerSoft;
              borderColor = theme.danger;
            }
          }
          return (
            <Pressable
              key={i}
              accessibilityRole="radio"
              accessibilityLabel={`Opción ${i + 1}`}
              accessibilityState={{
                checked: seleccionada,
                disabled: estado === "aprobado",
              }}
              disabled={estado === "aprobado"}
              onPress={() => elegir(i)}
              style={({ pressed }) => [
                styles.option,
                { backgroundColor, borderColor },
                pressed && estado !== "aprobado" ? styles.pressed : null,
              ]}
            >
              <ThemedText variant="label" style={styles.optionText}>
                {opt.text}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.footer}>
        {estado === "aprobado" ? (
          <View style={styles.result} role="status">
            <CheckCircle2 size={18} color={theme.success} />
            <ThemedText variant="label" style={styles.resultOk}>
              ¡Correcto!
            </ThemedText>
          </View>
        ) : (
          <>
            {estado === "error" ? (
              <View style={styles.result} role="alert">
                <ThemedText variant="label" style={styles.resultBad}>
                  No era esa. Escuchá de nuevo.
                </ThemedText>
              </View>
            ) : null}
            <Button
              title={estado === "error" ? "Intentar de nuevo" : "Revisar"}
              variant={estado === "error" ? "secondary" : "primary"}
              icon={
                estado === "error" ? (
                  <RotateCcw size={18} color={theme.primary} />
                ) : undefined
              }
              onPress={revisar}
              disabled={elegida === null}
            />
          </>
        )}
      </View>
    </View>
  );
}

/**
 * Botón de audio del ejercicio: carga el adaptador una vez y alterna
 * play/pausa. Se remonta con `key={audioUri}` cuando la URI resuelta
 * cambia (misma pauta que `CachedLessonAudio` de la lección).
 */
function AudioButton({ url }: { url: string }) {
  const [playing, setPlaying] = useState(false);
  const playerRef = useRef<AudioPlayer | null>(null);
  const loadedRef = useRef(false);

  useEffect(() => {
    return () => {
      loadedRef.current = false;
      playerRef.current?.unload().catch(() => {});
    };
  }, []);

  const toggle = async () => {
    if (!playerRef.current) playerRef.current = createAudioPlayer();
    const player = playerRef.current;
    if (loadedRef.current) {
      if (playing) {
        await player.pause();
        setPlaying(false);
      } else {
        await player.seekTo(0);
        await player.play();
        setPlaying(true);
      }
      return;
    }
    try {
      await player.load(url, () => setPlaying(false));
      loadedRef.current = true;
      await player.play();
      setPlaying(true);
    } catch {
      // best-effort: el botón queda en "Reproducir audio"
    }
  };

  return (
    <Button
      title={playing ? "Pausar audio" : "Reproducir audio"}
      variant="secondary"
      icon={<Volume2 size={18} color={theme.primary} />}
      onPress={toggle}
    />
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  noSource: { color: theme.muted },
  question: { color: theme.text },
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
