import { Tabs } from "expo-router";
import { AuthProvider } from "../auth";
import { DbProvider } from "../db-context";

export default function RootLayout() {
  return (
    <AuthProvider>
      <DbProvider>
        <Tabs
          screenOptions={{
            headerStyle: { backgroundColor: "#7c2d12" },
            headerTintColor: "#fff",
            tabBarActiveTintColor: "#7c2d12",
          }}
        >
          <Tabs.Screen name="index" options={{ title: "Buscar" }} />
          <Tabs.Screen name="explorar" options={{ title: "A-Z" }} />
          <Tabs.Screen name="favoritos" options={{ title: "Favoritas" }} />
          <Tabs.Screen name="historial" options={{ title: "Historial" }} />
          <Tabs.Screen name="ajustes" options={{ title: "Ajustes" }} />
          <Tabs.Screen name="ficha/[id]" options={{ href: null, title: "Ficha" }} />
        </Tabs>
      </DbProvider>
    </AuthProvider>
  );
}
