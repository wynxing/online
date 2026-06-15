import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { UpdateBanner } from "../../components/UpdateBanner";
import { withLang } from "../helpers";

type UpdateBannerProps = ComponentProps<typeof UpdateBanner>;

const defaultProps: UpdateBannerProps = {
  status: "idle",
  updateInfo: null,
  progress: { downloaded: 0, total: 0 },
  error: null,
  onUpdate: vi.fn(),
  onDismiss: vi.fn(),
};

function renderBanner(overrides: Partial<UpdateBannerProps> = {}) {
  const props = { ...defaultProps, ...overrides };
  return { ...render(withLang(<UpdateBanner {...props} />, "zh")), props };
}

describe("UpdateBanner", () => {
  it("does not render while idle", () => {
    renderBanner();
    expect(screen.queryByText(/更新/)).not.toBeInTheDocument();
  });

  it("renders check errors even when update info is missing", () => {
    renderBanner({ status: "error", error: "manifest unavailable" });

    expect(screen.getByText("更新检查失败：manifest unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
  });

  it("calls onUpdate when retry is clicked", () => {
    const onUpdate = vi.fn();
    renderBanner({ status: "error", error: "network failed", onUpdate });

    fireEvent.click(screen.getByRole("button", { name: "重试" }));

    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it("renders available update details", () => {
    renderBanner({
      status: "available",
      updateInfo: { version: "0.4.13", notes: "Bug fixes" },
    });

    expect(screen.getByText(/发现新版本/)).toBeInTheDocument();
    expect(screen.getByText("v0.4.13")).toBeInTheDocument();
    expect(screen.getByText(/Bug fixes/)).toBeInTheDocument();
  });
});
