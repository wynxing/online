import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTheme } from "../../hooks/useTheme";

const addEventListener = vi.fn();
const removeEventListener = vi.fn();

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  addEventListener.mockReset();
  removeEventListener.mockReset();
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: true,
      media: "(prefers-color-scheme: dark)",
      onchange: null,
      addEventListener,
      removeEventListener,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
  );
});

describe("useTheme", () => {
  it("uses the system preference and manages its change listener", () => {
    const hook = renderHook(() => useTheme());

    expect(hook.result.current.theme).toBe("system");
    expect(hook.result.current.resolvedTheme).toBe("dark");
    expect(document.documentElement).not.toHaveAttribute("data-theme");
    expect(addEventListener).toHaveBeenCalledWith("change", expect.any(Function));

    hook.unmount();
    expect(removeEventListener).toHaveBeenCalledWith("change", expect.any(Function));
  });

  it("sets, persists, and cycles explicit themes", () => {
    window.localStorage.setItem("theme", "light");
    const hook = renderHook(() => useTheme());

    act(() => hook.result.current.setTheme("dark"));
    expect(hook.result.current.theme).toBe("dark");
    expect(hook.result.current.resolvedTheme).toBe("dark");
    expect(window.localStorage.getItem("theme")).toBe("dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");

    act(() => hook.result.current.cycleTheme());
    expect(hook.result.current.theme).toBe("system");
    expect(document.documentElement).not.toHaveAttribute("data-theme");
  });
});
