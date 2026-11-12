import { describe, it, expect, jest } from "@jest/globals";
import { render, screen, userEvent } from "@testing-library/react-native";
import { Text } from "react-native";
import { Card, Chip, Screen, ThemedText } from "../index";

/**
 * Smoke del kit base (`src/components/ui`): contrato de cada primitiva con
 * su rol accesible, su estado y su contenido.
 */
describe("Kit UI (components/ui)", () => {
  it("Card muestra sus hijos", () => {
    render(
      <Card>
        <Text>contenido</Text>
      </Card>
    );
    expect(screen.getByText("contenido")).toBeTruthy();
  });

  it("Card sin onPress no es interactivo", () => {
    render(
      <Card>
        <Text>contenido</Text>
      </Card>
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("Card con onPress es un botón accesible", async () => {
    const onPress = jest.fn();
    render(
      <Card onPress={onPress} accessibilityRole="button" accessibilityLabel="Tarjeta">
        <Text>contenido</Text>
      </Card>
    );

    const user = userEvent.setup();
    await user.press(screen.getByRole("button", { name: "Tarjeta" }));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("Chip sin onPress es estático y Chip con onPress es botón", async () => {
    const onPress = jest.fn();
    render(
      <>
        <Chip label="hogar" />
        <Chip label="agua" tone="accent" onPress={onPress} />
      </>
    );

    expect(screen.getByText("hogar")).toBeTruthy();
    const chip = screen.getByRole("button", { name: "agua" });

    const user = userEvent.setup();
    await user.press(chip);

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("Chip marcado como seleccionado expone el estado", () => {
    render(<Chip label="hogar" selected onPress={() => undefined} />);
    expect(screen.getByRole("button", { name: "hogar" })).toBeSelected();
  });

  it("Screen renderiza sus hijos", () => {
    render(
      <Screen>
        <ThemedText variant="title">Título</ThemedText>
      </Screen>
    );
    expect(screen.getByText("Título")).toBeTruthy();
  });
});
