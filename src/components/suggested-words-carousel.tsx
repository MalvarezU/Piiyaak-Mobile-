import { useEffect, useState } from "react";
import {
  Dimensions,
  FlatList,
  Image,
  View,
  StyleSheet,
} from "react-native";
import { BookOpen } from "lucide-react-native";
import { theme, type, radiusScale, spacing } from "../theme";
import { Card, Chip, ThemedText } from "./ui";
import { resolveBundledIllustrationUri } from "../illustrations";
import type { WordRow } from "../db/types";

export interface SuggestedWordsCarouselProps {
  words: WordRow[];
  onPressWord: (id: string) => void;
}

const SCREEN_WIDTH = Dimensions.get("window").width;
const ITEM_WIDTH = Math.round(SCREEN_WIDTH * 0.85);

export function SuggestedWordsCarousel({
  words,
  onPressWord,
}: SuggestedWordsCarouselProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [illustrations, setIllustrations] = useState<Record<string, string | null>>({});

  useEffect(() => {
    let alive = true;
    (async () => {
      const next: Record<string, string | null> = {};
      await Promise.all(
        words.map(async (w) => {
          if (!w.illustrationUrl) {
            next[w.id] = null;
            return;
          }
          const uri = await resolveBundledIllustrationUri(w.illustrationUrl);
          next[w.id] = uri;
        })
      );
      if (alive) setIllustrations(next);
    })();
    return () => {
      alive = false;
    };
  }, [words]);

  if (words.length === 0) return null;

  return (
    <View style={styles.container}>
      <FlatList
        data={words}
        keyExtractor={(w) => w.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        snapToInterval={ITEM_WIDTH}
        decelerationRate="fast"
        contentContainerStyle={styles.listContent}
        onMomentumScrollEnd={(e) => {
          const idx = Math.round(e.nativeEvent.contentOffset.x / (ITEM_WIDTH + spacing.md));
          setActiveIndex(Math.max(0, Math.min(words.length - 1, idx)));
        }}
        renderItem={({ item }) => {
          const uri = illustrations[item.id];
          const hasImage = !!uri;
          return (
            <View style={[styles.item, { width: ITEM_WIDTH }]}>
              <Card
                onPress={() => onPressWord(item.id)}
                accessibilityRole="button"
                style={styles.card}
              >
                <View style={styles.illustrationBox}>
                  {hasImage ? (
                    <Image
                      source={{ uri: uri as string }}
                      style={styles.image}
                      resizeMode="cover"
                      accessibilityLabel={item.spanish}
                    />
                  ) : (
                    <View style={styles.placeholder}>
                      <BookOpen size={32} color={theme.muted} />
                    </View>
                  )}
                </View>
                <ThemedText variant="word" style={styles.nasaYuwe}>
                  {item.nasaYuwe}
                </ThemedText>
                <ThemedText variant="body" style={styles.spanish}>
                  {item.spanish}
                </ThemedText>
                {item.category ? <Chip label={item.category} tone="accent" /> : null}
              </Card>
            </View>
          );
        }}
      />
      {words.length > 1 ? (
        <View style={styles.dots}>
          {words.map((w, i) => (
            <View
              key={w.id}
              style={[styles.dot, i === activeIndex ? styles.dotActive : null]}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.sm },
  listContent: { paddingHorizontal: spacing.xs },
  item: { marginRight: spacing.md },
  card: { gap: spacing.xs },
  illustrationBox: {
    width: "100%",
    aspectRatio: 16 / 9,
    borderRadius: radiusScale.sm,
    overflow: "hidden",
    backgroundColor: theme.background,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  image: { width: "100%", height: "100%" },
  placeholder: { justifyContent: "center", alignItems: "center" },
  nasaYuwe: { ...type.word, fontSize: 24, lineHeight: 30 },
  spanish: { color: theme.muted },
  dots: {
    flexDirection: "row",
    justifyContent: "center",
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: radiusScale.full,
    backgroundColor: theme.border,
  },
  dotActive: {
    width: 16,
    backgroundColor: theme.primary,
  },
});
