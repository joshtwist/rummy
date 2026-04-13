export function getPlayerId(gameId: string): string | null {
  try {
    return localStorage.getItem(`rummy:game:${gameId}:playerId`);
  } catch {
    return null;
  }
}

export function setPlayerId(gameId: string, playerId: string): void {
  try {
    localStorage.setItem(`rummy:game:${gameId}:playerId`, playerId);
  } catch {
    // localStorage may be unavailable (private browsing, full storage, etc.)
  }
}
