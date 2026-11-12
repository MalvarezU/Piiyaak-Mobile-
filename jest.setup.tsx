/**
 * Setup global de los tests de UI (Jest).
 *
 * Aquí se mockean los módulos nativos de Expo/React Native para que el render
 * funcione en Node: reanimated (worklets), secure-store, async-storage,
 * expo-router y los módulos con efectos de plataforma.
 */
import "@testing-library/react-native";

// Reanimated necesita su mock en tests (los worklets no corren en Node).
jest.mock("react-native-reanimated", () => require("react-native-reanimated/mock"));

// expo-router: las pantallas usan Link/useRouter/useLocalSearchParams.
jest.mock("expo-router", () => {
  const React = require("react");
  return {
    __esModule: true,
    Link: ({ children }: { children: React.ReactNode }) =>
      React.createElement("Link", null, children),
    Stack: {
      Screen: () => null,
      Push: () => null,
    },
    Tabs: { Screen: () => null },
    useRouter: () => ({
      push: jest.fn(),
      replace: jest.fn(),
      back: jest.fn(),
      navigate: jest.fn(),
      setParams: jest.fn(),
    }),
    useLocalSearchParams: () => ({}),
    useGlobalSearchParams: () => ({}),
    usePathname: () => "/",
    useSegments: () => [],
  };
});

// expo-secure-store: mapa en memoria.
jest.mock("expo-secure-store", () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      store.delete(key);
    }),
    isAvailableAsync: jest.fn(async () => true),
  };
});

// @react-native-async-storage/async-storage: mapa en memoria.
jest.mock("@react-native-async-storage/async-storage", () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (key: string) => store.get(key) ?? null),
      setItem: jest.fn(async (key: string, value: string) => {
        store.set(key, value);
      }),
      removeItem: jest.fn(async (key: string) => {
        store.delete(key);
      }),
      clear: jest.fn(async () => {
        store.clear();
      }),
      getAllKeys: jest.fn(async () => [...store.keys()]),
      multiGet: jest.fn(async () => []),
      multiSet: jest.fn(async () => undefined),
      multiRemove: jest.fn(async () => undefined),
    },
  };
});

// expo-audio: no hay reproducción en tests.
jest.mock("expo-audio", () => ({
  __esModule: true,
  useAudioPlayer: () => ({
    play: jest.fn(),
    pause: jest.fn(),
    replace: jest.fn(),
    seekTo: jest.fn(),
    remove: jest.fn(),
    isPlaying: false,
    currentTime: 0,
    duration: 0,
  }),
  setAudioModeAsync: jest.fn(async () => undefined),
  createAudioPlayer: jest.fn(() => ({
    play: jest.fn(),
    pause: jest.fn(),
    replace: jest.fn(),
    seekTo: jest.fn(),
    remove: jest.fn(),
  })),
  AudioModule: {},
}));
