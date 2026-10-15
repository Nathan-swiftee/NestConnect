import { Linking, Text } from "react-native";
import { fireEvent, render } from "@testing-library/react-native";
import { LinkedText } from "../src/components/LinkedText";

// The theme reads the stored appearance setting, which needs a native module.
jest.mock("../src/theme", () => ({ useTheme: () => ({ scheme: "light", c: {} }) }));

/**
 * A link typed into a message is tappable in the app, opens where it says,
 * and the words around it are left as they were.
 */
it("makes the link in a message tappable and opens it", () => {
  const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
  const screen = render(
    <Text>
      <LinkedText text="Track it at swiftee.co.uk/track. Thanks" />
    </Text>,
  );
  const link = screen.getByRole("link");
  expect(link.props.children).toBe("swiftee.co.uk/track");
  fireEvent.press(link);
  expect(open).toHaveBeenCalledWith("https://swiftee.co.uk/track");
  expect(screen.getByText(/Track it at/)).toBeTruthy();
});

it("leaves a message with no links as plain text", () => {
  const screen = render(
    <Text>
      <LinkedText text="Version 1.2 is out, e.g. today" />
    </Text>,
  );
  expect(screen.queryByRole("link")).toBeNull();
});
