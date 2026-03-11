import { getChampions } from "./ddragon.js";

const { API_KEY, REGION } = process.env;

export const riotHeaders = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
  "X-Riot-Token": API_KEY,
};

export const getPUUID = async (gameName, tagLine, region = REGION) => {
  try {
    const url = `https://${region}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${gameName}/${tagLine}`;

    const res = await fetch(url, {
      headers: riotHeaders,
    });

    if (!res.ok) {
      throw new Error("Account not found");
    }

    return res.json();
  } catch (err) {
    console.error("Error retrieving PUUID", err);
    throw new Error("Account not found");
  }
};

export const getCurrentGame = async (puuid, spectateRegion) => {
  const url = `https://${spectateRegion}.api.riotgames.com/lol/spectator/v5/active-games/by-summoner/${puuid}`;

  const res = await fetch(url, {
    headers: riotHeaders,
  });

  if (res.status === 404) {
    return null;
  }

  if (!res.ok) {
    throw new Error("Spectator API error");
  }

  return res.json();
};

export const getLeagueEntries = async (game, player) => {
  const res = await fetch(
    `https://${game.platformId.toLowerCase()}.api.riotgames.com/lol/league/v4/entries/by-puuid/${player.puuid}`,
    {
      headers: riotHeaders,
    },
  );

  if (res.status === 404) {
    return null;
  }

  if (!res.ok) {
    return null;
  }

  const entries = await res.json();

  return entries;
};

export const getLobbyData = async (game) => {
  const champions = getChampions();

  try {
    let players = null;

    try {
      const playersPromisesRes = await Promise.allSettled(
        (game.participants || []).map(async (p) => {
          if (!p.puuid) {
            return null;
          }

          const participant = await getLeagueEntries(game, p);

          const soloQ =
            participant?.find((e) => e.queueType === "RANKED_SOLO_5x5") || null;

          return {
            name: p.riotId,
            champion: champions.find(({ key }) => key === String(p.championId))
              ?.name,
            soloQ,
            teamId: p.teamId,
          };
        }),
      );

      const playersRes = playersPromisesRes
        .map(({ value }) => value)
        .filter(Boolean);

      players = playersRes.reduce(
        (obj, participant) => {
          const teamName = participant.teamId === 100 ? "BLUE" : "RED";

          obj[teamName].push({
            champion: participant.champion,
            rank: participant.soloQ,
            fullRank: participant.soloQ?.tier
              ? `${participant.soloQ?.tier} ${participant.soloQ?.rank} ${participant.soloQ?.leaguePoints}LP ${participant.soloQ?.wins}W-${participant.soloQ?.losses}L`
              : "UNRANKED",
          });

          return obj;
        },
        { BLUE: [], RED: [] },
      );
    } catch (err) {
      console.error("Failed to get player lobby stats.", err);
    }

    const bannedChampionsRaw = structuredClone(
      game.bannedChampions || [],
    )?.sort((a, b) => a.pickTurn - b.pickTurn);

    const bannedChampions = bannedChampionsRaw.reduce(
      (obj, ban) => {
        const teamName = ban.teamId === 100 ? "BLUE" : "RED";

        obj[teamName].push(
          champions.find(({ key }) => key === String(ban.championId))?.name ||
            (ban.championId !== -1 ? ban.championId : "[No ban]"),
        );

        return obj;
      },
      { BLUE: [], RED: [] },
    );

    return {
      players: players || null,
      bannedChampions: bannedChampions || null,
    };
  } catch (err) {
    console.error("Something went wrong getting player statistics.", err);
    return null;
  }
};
