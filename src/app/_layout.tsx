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
          <Tabs.Screen name="juegos/index" options={{ href: null, title: "Juegos" }} />
          <Tabs.Screen name="juegos/flashcards" options={{ href: null, title: "Flashcards" }} />
          <Tabs.Screen name="juegos/memoria" options={{ href: null, title: "Memoria" }} />
          <Tabs.Screen name="juegos/completar" options={{ href: null, title: "Completar" }} />
          <Tabs.Screen name="cursos/index" options={{ href: null, title: "Cursos" }} />
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
