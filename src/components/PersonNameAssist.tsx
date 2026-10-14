import { History, UserPlus } from "lucide-react";
import type { PointerEvent, MouseEvent } from "react";
import {
  indexPeople,
  isPlaceholderName,
  nameKey,
  resolvePersonForName,
  type PeopleDirectory
} from "../domain/people";
import type { Player } from "../domain/pokerTypes";
import { filterPersonSuggestions, type PersonSuggestion } from "../domain/sessionHistory";

type PersonNameAssistProps = {
  /** The name being typed. */
  name: string;
  /** The link the player has (or was just picked) for this entry. */
  personId?: string;
  directory: PeopleDirectory;
  suggestions: PersonSuggestion[];
  /** The other players in this game, whose people and names are not offered again. */
  otherPlayers: Player[];
  showSuggestions: boolean;
  onPick: (suggestion: PersonSuggestion) => void;
};

// Keeps focus in the name field so picking does not commit the half-typed name first.
const keepFocus = (event: PointerEvent | MouseEvent) => event.preventDefault();

/**
 * Shows which Player History person a typed name belongs to, and offers known
 * people to pick from. Exact (case-insensitive) name or alias matches link on
 * their own; anything else becomes a new person when the game is archived.
 */
export function PersonNameAssist({
  name,
  personId,
  directory,
  suggestions,
  otherPlayers,
  showSuggestions,
  onPick
}: PersonNameAssistProps) {
  const index = indexPeople(directory);
  const linkedId = resolvePersonForName(directory, name, personId);
  const linked = linkedId ? index.root(linkedId) : undefined;
  const games = linked ? suggestions.find((suggestion) => suggestion.personId === linked.id)?.games ?? 0 : 0;
  const match = index.lookupName(name);
  const trimmed = name.trim();

  let status: string | null = null;
  if (linked) {
    status = `Player History: ${linked.name}${games > 0 ? ` · ${games} ${games === 1 ? "game" : "games"}` : ""}`;
  } else if (match.kind === "ambiguous") {
    status = `More than one person is called ${trimmed}. Pick one below.`;
  } else if (trimmed && !isPlaceholderName(trimmed)) {
    status = "New to Player History";
  }

  const shown = showSuggestions
    ? filterPersonSuggestions(suggestions, name, {
        personIds: new Set(
          [
            ...otherPlayers.flatMap((player) => (player.personId ? [index.rootId(player.personId) ?? player.personId] : [])),
            ...(linked ? [linked.id] : [])
          ]
        ),
        nameKeys: new Set(otherPlayers.map((player) => nameKey(player.name)).filter(Boolean))
      })
    : [];

  if (!status && shown.length === 0) return null;

  return (
    <div className="person-name-assist">
      {status ? (
        <span className={`person-link-status ${linked ? "is-linked" : ""}`}>
          {linked ? <History size={13} aria-hidden="true" /> : <UserPlus size={13} aria-hidden="true" />}
          {status}
        </span>
      ) : null}
      {shown.length > 0 ? (
        <div className="person-suggestions" role="group" aria-label="Known players">
          {shown.map((suggestion) => (
            <button
              className="person-suggestion"
              key={suggestion.key}
              type="button"
              onPointerDown={keepFocus}
              onMouseDown={keepFocus}
              onClick={() => onPick(suggestion)}
              aria-label={`Use ${suggestion.name}${suggestion.games > 0 ? ` (${suggestion.games} ${suggestion.games === 1 ? "game" : "games"})` : ""}`}
            >
              <span>{suggestion.name}</span>
              {suggestion.games > 0 ? <small>{suggestion.games}</small> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
