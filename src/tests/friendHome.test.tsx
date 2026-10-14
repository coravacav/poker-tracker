import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StartPage } from "../components/StartPage";
import { GuestSessionControls } from "../components/SharingControls";
import { createDefaultGameState } from "../state/seedGame";

const profile = {
  schemaVersion: 1 as const,
  friendCode: "2345ABCDEFGHJKLMNPQR",
  displayName: "Alex",
  ownerSecret: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG"
};

describe("friend discovery on Home", () => {
  it("shows a followed friend's live room and joins it", () => {
    const onJoin = vi.fn();
    const live = {
      friendCode: "9876ZYXWVUTSRQPNMLKJ",
      displayName: "Blair",
      room: { publicId: "room_public_123456", name: "Friday Poker", createdAt: 1 }
    };
    render(
      <StartPage
        entry={{ reason: "stale_return", savedGame: createDefaultGameState() }}
        friendFeatureAvailable
        friendProfile={profile}
        followedFriends={[{ schemaVersion: 1, friendCode: live.friendCode, displayName: "Blair" }]}
        friendActivity={[live]}
        onContinue={() => undefined}
        onStartNew={() => undefined}
        onJoinFriendRoom={onJoin}
      />
    );

    expect(screen.getByText("Friday Poker is live")).toBeInTheDocument();
    expect(screen.getByLabelText("Personal friend code QR")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    expect(onJoin).toHaveBeenCalledWith(live);
  });

  it("prefills a scanned code and submits a follow", () => {
    const onAddFriend = vi.fn();
    render(
      <StartPage
        entry={{ reason: "first_visit", savedGame: null }}
        friendFeatureAvailable
        friendProfile={profile}
        initialFriendCode="9876ZYXWVUTSRQPNMLKJ"
        onContinue={() => undefined}
        onStartNew={() => undefined}
        onAddFriend={onAddFriend}
      />
    );

    expect(screen.getByLabelText("Friend code")).toHaveValue("9876-ZYXW-VUTS-RQPN-MLKJ");
    fireEvent.click(screen.getByRole("button", { name: "Follow" }));
    expect(onAddFriend).toHaveBeenCalledWith("9876ZYXWVUTSRQPNMLKJ");
  });

  it("offers an invite guest the option to follow the host", () => {
    const onFollowHost = vi.fn();
    render(
      <GuestSessionControls
        connected
        ended={false}
        displayName="Alex"
        hostProfile={{ friendCode: "9876ZYXWVUTSRQPNMLKJ", displayName: "Blair" }}
        onFollowHost={onFollowHost}
        onLeave={() => undefined}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Follow Blair" }));
    expect(onFollowHost).toHaveBeenCalledOnce();
  });
});
