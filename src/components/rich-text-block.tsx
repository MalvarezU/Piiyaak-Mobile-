import { Text, View, StyleSheet } from "react-native";
import { theme } from "../theme";
import { parseRichText, type BlockNode, type InlineNode } from "../lib/rich-text";

export interface RichTextBlockProps {
  html: string;
}

export function RichTextBlock({ html }: RichTextBlockProps) {
  const blocks = parseRichText(html);
  return (
    <View>
      {blocks.map((block, i) => (
        <BlockView key={i} block={block} />
      ))}
    </View>
  );
}

function BlockView({ block }: { block: BlockNode }) {
  switch (block.type) {
    case "h1":
      return <Text style={styles.h1}>{renderInline(block.children)}</Text>;
    case "h2":
      return <Text style={styles.h2}>{renderInline(block.children)}</Text>;
    case "h3":
      return <Text style={styles.h3}>{renderInline(block.children)}</Text>;
    case "p":
      return <Text style={styles.p}>{renderInline(block.children)}</Text>;
    case "ul":
      return (
        <View style={styles.ul}>
          {block.items.map((item, i) => (
            <View key={i} style={styles.li}>
              <Text style={styles.bullet}>• </Text>
              <Text style={styles.liText}>{renderInline(item)}</Text>
            </View>
          ))}
        </View>
      );
    case "br":
      return <Text>{"\n"}</Text>;
    default:
      return null;
  }
}

function renderInline(nodes: InlineNode[]): React.ReactNode {
  return nodes.map((node, i) => {
    if (node.type === "text") {
      return <Text key={i}>{node.text}</Text>;
    }
    if (node.type === "bold") {
      return (
        <Text key={i} style={styles.bold}>
          {renderInline(node.children)}
        </Text>
      );
    }
    if (node.type === "italic") {
      return (
        <Text key={i} style={styles.italic}>
          {renderInline(node.children)}
        </Text>
      );
    }
    return null;
  });
}

const styles = StyleSheet.create({
  h1: { fontSize: 20, fontWeight: "bold", marginBottom: 6, color: theme.primary },
  h2: { fontSize: 18, fontWeight: "bold", marginBottom: 4, color: theme.primary },
  h3: { fontSize: 16, fontWeight: "600", marginBottom: 4 },
  p: { fontSize: 15, lineHeight: 22, marginBottom: 8 },
  ul: { marginBottom: 8 },
  li: { flexDirection: "row", marginBottom: 4 },
  bullet: { fontSize: 15, marginRight: 4 },
  liText: { fontSize: 15, lineHeight: 22, flex: 1 },
  bold: { fontWeight: "bold" },
  italic: { fontStyle: "italic" },
});