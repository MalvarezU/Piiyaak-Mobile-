import { describe, it, expect, jest } from "@jest/globals";
import { render, screen, userEvent } from "@testing-library/react-native";
import { Button } from "../button";

describe("Button (UI smoke)", () => {
  it("renderiza el título y dispara onPress", async () => {
    const onPress = jest.fn();
    render(<Button title="Guardar" onPress={onPress} />);

    expect(screen.getByText("Guardar")).toBeTruthy();

    const user = userEvent.setup();
    await user.press(screen.getByRole("button", { name: "Guardar" }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("expone estado deshabilitado y no dispara onPress", async () => {
    const onPress = jest.fn();
    render(<Button title="Guardar" onPress={onPress} disabled />);

    const button = screen.getByRole("button", { name: "Guardar" });
    expect(button.props.accessibilityState).toMatchObject({ disabled: true });

    const user = userEvent.setup();
    await user.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it("muestra spinner y oculta el título cuando loading", () => {
    render(<Button title="Guardar" onPress={() => {}} loading />);
    expect(screen.queryByText("Guardar")).toBeNull();
    expect(screen.getByRole("button", { name: "Guardar" }).props.accessibilityState).toMatchObject({
      busy: true,
    });
  });
});
