import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StartPage } from "../components/StartPage";
import { GuestSessionControls } from "../components/SharingControls";
import { createDefaultGameState } from "../state/seedGame";
import type { RoomTransport } from "../session/types";
import { useFriendDiscovery } from "../session/useFriendDiscovery";

const profile = {
  schemaVersion: 1 as const,
  friendCode: "2345ABCDEFGHJKLMNPQR",
  displayName: "Alex",
  ownerSecret: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG"
};

describe("friend discovery on Home", () => {
  it("shows a followed friend's live room and joins it", async () => {
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
    // The QR encoder is a lazily loaded chunk.
    expect(await screen.findByLabelText("Personal friend code QR")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    expect(onJoin).toHaveBeenCalledWith(live, live.room);
  });

  it("lists and joins each room a followed friend is sharing", () => {
    const onJoin = vi.fn();
    const rooms = [
      { publicId: "room_public_second12", name: "Late Game", createdAt: 2 },
      { publicId: "room_public_123456", name: "Friday Poker", createdAt: 1 }
    ];
    const live = { friendCode: "9876ZYXWVUTSRQPNMLKJ", displayName: "Blair", room: rooms[0], rooms };
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

    expect(screen.getByText("Late Game is live")).toBeInTheDocument();
    expect(screen.getByText("Friday Poker is live")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Join Friday Poker" }));
    expect(onJoin).toHaveBeenCalledWith(live, rooms[1]);
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

  it("creates a friend profile with only the fields the backend accepts", async () => {
    localStorage.clear();
    const createFriendProfile = vi.fn(async (args: { friendCode: string; displayName: string }) => ({
      friendCode: args.friendCode,
      displayName: args.displayName
    }));
    const transport = {
      configured: true,
      createFriendProfile,
      lookupFriendProfile: vi.fn(async () => null),
      subscribeFriendActivity: vi.fn(() => () => undefined)
    } as unknown as RoomTransport;
    const { result } = renderHook(() =>
      useFriendDiscovery({
        transport,
        sessionRef: { current: { mode: "local", notice: null } },
        setSession: vi.fn(),
        setLocalEntry: vi.fn(),
        refreshRoomHistory: async () => undefined
      })
    );

    await act(() => result.current.createFriendProfile("Alex"));

    // Convex validators reject unknown fields, so the local schemaVersion must not be sent.
    expect(Object.keys(createFriendProfile.mock.calls[0]![0]).sort()).toEqual([
      "displayName",
      "friendCode",
      "ownerSecret"
    ]);
    expect(result.current.friendError).toBeNull();
    expect(result.current.friendProfile).toMatchObject({ schemaVersion: 1, displayName: "Alex" });
  });
});
