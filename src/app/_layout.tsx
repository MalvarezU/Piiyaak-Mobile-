import { Tabs } from "expo-router";
import { useFonts } from "expo-font";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
} from "@expo-google-fonts/inter";
import {
  SourceSerif4_400Regular,
  SourceSerif4_600SemiBold,
  SourceSerif4_700Bold,
} from "@expo-google-fonts/source-serif-4";
import { theme, fonts } from "../theme";
import { Home, ArrowDownAZ, Heart, History, Settings } from "lucide-react-native";
import { Image, Text, View } from "react-native";
import { AuthProvider } from "../auth";
import { DbProvider } from "../db-context";

const logoWhite = require("../../assets/logo-white.png");

/** Fuentes offline desde instalación (al binario del APK, sin red). */
const FONT_MAP = {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  SourceSerif4_400Regular,
  SourceSerif4_600SemiBold,
  SourceSerif4_700Bold,
};

export default function RootLayout() {
  const [fontsLoaded] = useFonts(FONT_MAP);
  if (!fontsLoaded) {
    // Carga en milisegundos desde el APK: sin fuente = sin render.
    return null;
  }

  return (
    <AuthProvider>
      <DbProvider>
        <Tabs
          screenOptions={{
            headerStyle: { backgroundColor: theme.montana },
            headerTintColor: theme.onTint,
            headerTitleStyle: { fontFamily: fonts.sansSemibold },
            tabBarActiveTintColor: theme.montana,
            tabBarInactiveTintColor: theme.muted,
            tabBarStyle: {
              backgroundColor: theme.card,
              borderTopColor: theme.border,
            },
          }}
        >
          <Tabs.Screen
            name="index"
            options={{
              title: "Inicio",
              tabBarIcon: ({ color, size }) => <Home color={color} size={size} />,
              headerTitle: () => (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Image source={logoWhite} style={{ width: 28, height: 28 }} resizeMode="contain" />
                  <Text style={{ fontFamily: fonts.serifSemibold, fontSize: 20, color: theme.onTint }}>Piiyaak</Text>
                </View>
              ),
            }}
          />
          <Tabs.Screen name="explorar" options={{ title: "A-Z", tabBarIcon: ({ color, size }) => <ArrowDownAZ color={color} size={size} /> }} />
          <Tabs.Screen name="favoritos" options={{ title: "Favoritas", tabBarIcon: ({ color, size }) => <Heart color={color} size={size} /> }} />
          <Tabs.Screen name="historial" options={{ title: "Historial", tabBarIcon: ({ color, size }) => <History color={color} size={size} /> }} />
          <Tabs.Screen name="ajustes" options={{ title: "Ajustes", tabBarIcon: ({ color, size }) => <Settings color={color} size={size} /> }} />
          <Tabs.Screen name="ficha/[id]" options={{ href: null, title: "Ficha" }} />
          <Tabs.Screen name="juegos/index" options={{ href: null, title: "Juegos" }} />
          <Tabs.Screen name="juegos/flashcards" options={{ href: null, title: "Flashcards" }} />
          <Tabs.Screen name="juegos/relacionar" options={{ href: null, title: "Relaciona" }} />
          <Tabs.Screen name="juegos/completar" options={{ href: null, title: "Completar" }} />
          <Tabs.Screen name="juegos/ordena" options={{ href: null, title: "Ordena" }} />
          <Tabs.Screen name="juegos/escucha" options={{ href: null, title: "Escucha" }} />          <Tabs.Screen name="cursos/index" options={{ href: null, title: "Cursos" }} />
          <Tabs.Screen name="cursos/[id]" options={{ href: null, title: "Curso" }} />
          <Tabs.Screen name="cursos/leccion/[id]" options={{ href: null, title: "Lección" }} />
          <Tabs.Screen name="registro" options={{ href: null, title: "Registro" }} />
          <Tabs.Screen name="recuperar" options={{ href: null, title: "Recuperar" }} />
          <Tabs.Screen name="resetear" options={{ href: null, title: "Resetear" }} />
        </Tabs>
      </DbProvider>
    </AuthProvider>
  );
}
