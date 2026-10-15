import { useCallback, useLayoutEffect, useRef } from "react";
import type { Player, PlayerId } from "../../domain/pokerTypes";

const CARD_REARRANGE_ANIMATION_MS = 240;

/**
 * Animates seat cards from their previous positions after players move. Call
 * `snapshotPlayerSeatRects` just before dispatching a seat change.
 */
export function usePlayerSeatAnimation(activePlayers: Player[]) {
  const playerSeatElementsRef = useRef(new Map<PlayerId, HTMLElement>());
  const previousPlayerRectsRef = useRef(new Map<PlayerId, DOMRect>());
  const cardAnimationsRef = useRef(new Map<PlayerId, Animation>());

  const setPlayerSeatElement = useCallback(
    (playerId: PlayerId, element: HTMLElement | null) => {
      if (element) {
        playerSeatElementsRef.current.set(playerId, element);
        return;
      }

      playerSeatElementsRef.current.delete(playerId);
    },
    []
  );

  function snapshotPlayerSeatRects() {
    previousPlayerRectsRef.current = new Map(
      Array.from(playerSeatElementsRef.current.entries()).map(([playerId, element]) => [
        playerId,
        element.getBoundingClientRect()
      ])
    );
  }

  useLayoutEffect(() => {
    const previousRects = previousPlayerRectsRef.current;

    if (previousRects.size === 0) {
      return;
    }

    previousPlayerRectsRef.current = new Map();

    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduceMotion) {
      return;
    }

    for (const player of activePlayers) {
      const element = playerSeatElementsRef.current.get(player.id);
      const previousRect = previousRects.get(player.id);

      if (!element || !previousRect || typeof element.animate !== "function") {
        continue;
      }

      const currentRect = element.getBoundingClientRect();
      const deltaX = previousRect.left - currentRect.left;
      const deltaY = previousRect.top - currentRect.top;

      if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) {
        continue;
      }

      cardAnimationsRef.current.get(player.id)?.cancel();
      element.classList.add("is-rearranging");

      const animation = element.animate(
        [
          { transform: `translate(${deltaX}px, ${deltaY}px)` },
          { transform: "translate(0, 0)" }
        ],
        {
          duration: CARD_REARRANGE_ANIMATION_MS,
          easing: "cubic-bezier(0.2, 0.8, 0.2, 1)"
        }
      );

      cardAnimationsRef.current.set(player.id, animation);

      const clearAnimation = () => {
        if (cardAnimationsRef.current.get(player.id) !== animation) {
          return;
        }

        cardAnimationsRef.current.delete(player.id);
        element.classList.remove("is-rearranging");
      };

      animation.addEventListener("finish", clearAnimation);
      animation.addEventListener("cancel", clearAnimation);
    }
  }, [activePlayers]);

  return { setPlayerSeatElement, snapshotPlayerSeatRects };
}
