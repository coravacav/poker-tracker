import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import { GuestSeatPrompt } from "../components/gameApp/GuestSeatPrompt";
import { GuestJoinScreen } from "../components/GuestJoinScreen";
import { HostSeatList } from "../components/HostSeatList";
import { TransactionForm } from "../components/TransactionForm";
import type { Player } from "../domain/pokerTypes";
import type { HostSeat, SeatOption } from "../session/types";

const seats: SeatOption[] = [
  { playerId: "player_alex", name: "Alex", claimed: false, isHost: true },
  { playerId: "player_jon", name: "Jon", claimed: true, isHost: false },
  { playerId: "player_maya", name: "Maya", claimed: false, isHost: false },
  { playerId: "player_priya", name: "Priya", claimed: false, isHost: false }
];

function joinScreen(seatList: SeatOption[] | undefined, onJoin = vi.fn()) {
  render(
    <GuestJoinScreen
      status="active"
      roomName="Friday Night Poker"
      seats={seatList}
      error={null}
      joining={false}
      onJoin={onJoin}
      onCancel={() => undefined}
    />
  );
  return onJoin;
}

describe("seat picker on the join screen", () => {
  it("asks who you are and joins on the seat picked", () => {
    const onJoin = joinScreen(seats);
    expect(screen.getByRole("heading", { name: "Who are you?" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Display name" })).not.toBeInTheDocument();

    const group = screen.getByRole("group", { name: "Seats" });
    expect(within(group).getByRole("button", { name: /Alex.*Host/ })).toBeDisabled();
    expect(within(group).getByRole("button", { name: /Jon.*Joined on another phone/ })).toBeDisabled();
    const join = screen.getByRole("button", { name: "Pick your seat" });
    expect(join).toBeDisabled();

    const maya = within(group).getByRole("button", { name: /Maya/ });
    expect(maya).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(maya);
    expect(maya).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(group).getByRole("button", { name: /Priya/ }));
    expect(maya).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(screen.getByRole("button", { name: "Join as Priya" }));
    expect(onJoin).toHaveBeenCalledWith({ playerId: "player_priya" });
  });

  it("drops a picked seat that another phone takes first", () => {
    const onJoin = vi.fn();
    const { rerender } = render(
      <GuestJoinScreen status="active" seats={seats} error={null} joining={false} onJoin={onJoin} onCancel={() => undefined} />
    );
    fireEvent.click(screen.getByRole("button", { name: /Maya/ }));
    rerender(
      <GuestJoinScreen
        status="active"
        seats={seats.map((seat) => (seat.playerId === "player_maya" ? { ...seat, claimed: true } : seat))}
        error="Someone else just took that seat. Pick another."
        joining={false}
        onJoin={onJoin}
        onCancel={() => undefined}
      />
    );
    expect(screen.getByRole("button", { name: /Maya.*Joined on another phone/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Pick your seat" })).toBeDisabled();
  });

  it("falls back to a name when every seat is taken", () => {
    const onJoin = joinScreen(seats.map((seat) => ({ ...seat, claimed: !seat.isHost })));
    expect(screen.queryByRole("group", { name: "Seats" })).not.toBeInTheDocument();
    expect(screen.getByText(/Every seat already has a phone/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Display name" }), { target: { value: "Casey" } });
    fireEvent.click(screen.getByRole("button", { name: "Join game" }));
    expect(onJoin).toHaveBeenCalledWith({ displayName: "Casey" });
  });

  it("falls back to a name when the room has no seats to offer", () => {
    joinScreen(undefined);
    expect(screen.getByRole("textbox", { name: "Display name" })).toBeInTheDocument();
  });
});

describe("a seat the host released", () => {
  it("can't be picked again from the guest's phone", () => {
    const onClaimSeat = vi.fn(async () => true);
    render(
      <GuestSeatPrompt
        seatPlayerId={null}
        seatLost="released"
        seats={seats.map((seat) => (seat.playerId === "player_maya" ? { ...seat, releasedByHost: true } : seat))}
        onClaimSeat={onClaimSeat}
      />
    );
    expect(screen.getByText("The host released your seat.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Pick your seat" }));
    const dialog = screen.getByRole("dialog", { name: "Pick your seat" });
    expect(within(dialog).getByRole("button", { name: /Maya.*Released by the host/ })).toBeDisabled();
  });

  it("explains a seat lost to a change at the table", () => {
    render(<GuestSeatPrompt seatPlayerId={null} seatLost="changed" seats={seats} onClaimSeat={vi.fn(async () => true)} />);
    expect(screen.getByText("Your seat changed on the host’s table.")).toBeInTheDocument();
  });
});

describe("pick your seat on Play", () => {
  it("prompts a guest without a seat and claims the one picked", async () => {
    const onClaimSeat = vi.fn(async () => true);
    render(<GuestSeatPrompt seatPlayerId={null} seats={seats} onClaimSeat={onClaimSeat} />);
    fireEvent.click(screen.getByRole("button", { name: "Pick your seat" }));
    const dialog = screen.getByRole("dialog", { name: "Pick your seat" });
    fireEvent.click(within(dialog).getByRole("button", { name: /Maya/ }));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "I'm Maya" }));
    });
    expect(onClaimSeat).toHaveBeenCalledWith("player_maya");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("stays out of the way once the guest has a seat, or when none is open", () => {
    const { rerender } = render(
      <GuestSeatPrompt seatPlayerId="player_maya" seats={seats} onClaimSeat={vi.fn(async () => true)} />
    );
    expect(screen.queryByRole("button", { name: "Pick your seat" })).not.toBeInTheDocument();
    rerender(
      <GuestSeatPrompt
        seatPlayerId={null}
        seats={seats.map((seat) => ({ ...seat, claimed: true }))}
        onClaimSeat={vi.fn(async () => true)}
      />
    );
    expect(screen.queryByRole("button", { name: "Pick your seat" })).not.toBeInTheDocument();
  });
});

const maya = "guest_maya" as Id<"roomGuests">;
const hostSeats: HostSeat[] = [
  { playerId: "player_alex", name: "Alex", isHost: true, guest: null },
  { playerId: "player_maya", name: "Maya", isHost: false, guest: { id: maya, displayName: "Maya", connected: true } },
  {
    playerId: "player_priya",
    name: "Priya",
    isHost: false,
    guest: { id: "guest_priya" as Id<"roomGuests">, displayName: "Priya", connected: false }
  },
  { playerId: "player_dev", name: "Dev", isHost: false, guest: null }
];

function hostList(seatList: HostSeat[], hostPlayerId: string | null, hostNotPlaying = false) {
  const handlers = { onReleaseSeat: vi.fn(), onAssignSeat: vi.fn(), onSetHostPlayer: vi.fn() };
  render(<HostSeatList seats={seatList} hostPlayerId={hostPlayerId} hostNotPlaying={hostNotPlaying} {...handlers} />);
  return handlers;
}

describe("host seat list", () => {
  it("shows which phone holds each seat, and releases or moves one", () => {
    const handlers = hostList(hostSeats, "player_alex");
    const list = screen.getByRole("region", { name: "Seats" });
    expect(within(list).getByText("2 phones joined")).toBeInTheDocument();
    expect(within(list).getByText("You (host)")).toBeInTheDocument();
    expect(within(list).getByText("Maya’s phone · online")).toBeInTheDocument();
    expect(within(list).getByText("Priya’s phone · away")).toBeInTheDocument();
    expect(within(list).getByText("No phone yet")).toBeInTheDocument();
    expect(within(list).queryByText("Which seat is yours?")).not.toBeInTheDocument();

    fireEvent.click(within(list).getByRole("button", { name: "Release Maya’s seat" }));
    // The seat shown goes along, so a phone that has moved since isn't released.
    expect(handlers.onReleaseSeat).toHaveBeenCalledWith(maya, "player_maya");

    const move = within(list).getByRole("combobox", { name: "Move Maya’s phone" });
    // Only open seats are offered: not the host's, and not another phone's.
    expect(within(move).getAllByRole("option").map((option) => option.textContent)).toEqual(["Move", "To Dev"]);
    fireEvent.change(move, { target: { value: "player_dev" } });
    expect(handlers.onAssignSeat).toHaveBeenCalledWith(maya, "player_dev");
  });

  it("marks a seat the host released, which the host's Move can still fill", () => {
    const handlers = hostList(
      hostSeats.map((seat) => (seat.playerId === "player_dev" ? { ...seat, releasedByHost: true } : seat)),
      "player_alex"
    );
    const list = screen.getByRole("region", { name: "Seats" });
    expect(within(list).getByText("Released · only you can assign it")).toBeInTheDocument();
    expect(within(list).queryByText("No phone yet")).not.toBeInTheDocument();
    fireEvent.change(within(list).getByRole("combobox", { name: "Move Maya’s phone" }), { target: { value: "player_dev" } });
    expect(handlers.onAssignSeat).toHaveBeenCalledWith(maya, "player_dev");
  });

  it("asks which seat is the host's until one is picked", () => {
    const handlers = hostList(hostSeats.map((seat) => ({ ...seat, isHost: false })), null);
    expect(screen.getByText("Which seat is yours?")).toBeInTheDocument();
    const picker = screen.getByRole("combobox", { name: "Your seat" });
    expect(within(picker).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "This is me…",
      "Alex",
      "Dev",
      "I’m not playing"
    ]);
    fireEvent.change(picker, { target: { value: "player_alex" } });
    expect(handlers.onSetHostPlayer).toHaveBeenCalledWith("player_alex");
  });

  it("stops asking once the room knows the host isn't playing", () => {
    hostList(hostSeats.map((seat) => ({ ...seat, isHost: false })), null, true);
    expect(screen.queryByText("Which seat is yours?")).not.toBeInTheDocument();
  });

  it("lets the host change or clear their seat", () => {
    const handlers = hostList(hostSeats, "player_alex");
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Your seat" }), {
      target: { value: "__not_playing__" }
    });
    expect(handlers.onSetHostPlayer).toHaveBeenCalledWith(null);
  });
});

describe("a seated guest's request", () => {
  const players: Player[] = ["Alex", "Maya", "Jon"].map((name, seatIndex) => ({
    id: `player_${name.toLowerCase()}`,
    name,
    seatIndex,
    isActive: true
  }));

  it("starts from the guest's own seat", () => {
    render(
      <TransactionForm
        defaultBuyInCents={2000}
        onAddTransaction={() => true}
        players={players}
        readOnly={false}
        defaultPlayerId="player_maya"
      />
    );
    expect(screen.getByRole("combobox", { name: "To" })).toHaveValue("player_maya");
    fireEvent.change(screen.getByRole("combobox", { name: "Type" }), { target: { value: "player_gave" } });
    expect(screen.getByRole("combobox", { name: "From" })).toHaveValue("player_maya");
    expect(screen.getByRole("combobox", { name: "To" })).toHaveValue("player_alex");
  });
});
