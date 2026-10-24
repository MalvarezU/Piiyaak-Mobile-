import { useState } from "react";
import { Image, Text, View, StyleSheet } from "react-native";

export interface WordIllustrationProps {
  url?: string | null;
  alt: string;
}

export function WordIllustration({ url, alt }: WordIllustrationProps) {
  const [failed, setFailed] = useState(false);

  if (!url) return null;

  if (failed) {
    return (
      <View style={styles.box}>
        <Text style={styles.fallback}>Ilustración no disponible</Text>
      </View>
    );
  }

  return (
    <View style={styles.box}>
      <Image
        source={{ uri: url }}
        style={styles.img}
        resizeMode="cover"
        accessibilityLabel={alt}
        onError={() => setFailed(true)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e7e5e4",
    overflow: "hidden",
    backgroundColor: "#fafaf9",
    justifyContent: "center",
    alignItems: "center",
  },
  img: {
    width: "100%",
    height: "100%",
  },
  fallback: {
    color: "#78716c",
    fontSize: 14,
  },
});
