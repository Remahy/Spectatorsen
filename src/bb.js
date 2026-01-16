import { fetch } from "undici";

const { BLUEBOTTLE_ENABLE, BLUEBOTTLE_ENDPOINT, BLUEBOTTLE_STYLE } =
  process.env;

export const resetCurrentGame = async () => {
  if (!BLUEBOTTLE_ENABLE) {
    return;
  }

  await Promise.allSettled([
    fetch(`${BLUEBOTTLE_ENDPOINT}/api/match/current`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }),
  ]);
};

export const resetTeams = async () => {
  const defaultTeam1 = {
    members: [],
    name: "Team",
    tag: "",
    isActive: true,
    primaryColor: "#FFFFFFFF",
    secondaryColor: "#FFFFFFFF",
    tertiaryColor: "#FFFFFFFF",
    backgroundColor: "#FF000000",
  };

  const defaultTeam2 = {
    members: [],
    name: "Team",
    tag: "",
    isActive: true,
    primaryColor: "#FFFFFFFF",
    secondaryColor: "#FFFFFFFF",
    tertiaryColor: "#FFFFFFFF",
    backgroundColor: "#FF000000",
  };

  try {
    const res = await fetch(`${BLUEBOTTLE_ENDPOINT}/api/team`);

    if (!res.ok) {
      throw new Error("Couldn't find teams.");
    }

    const teams = await res.json();

    const teamIds = teams.map(({ teamId }) => teamId);

    await Promise.allSettled(
      teamIds.map((teamId) =>
        fetch(`${BLUEBOTTLE_ENDPOINT}/api/team/${teamId}`, {
          method: "DELETE",
        })
      )
    );
  } catch {
    // noop
  }

  const teamsRes = (
    await Promise.allSettled([
      fetch(`${BLUEBOTTLE_ENDPOINT}/api/team`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },

        body: JSON.stringify(defaultTeam1),
      }),
      fetch(`${BLUEBOTTLE_ENDPOINT}/api/team`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(defaultTeam2),
      }),
    ])
  ).map(({ value }) => value);

  const teamIds = (
    await Promise.allSettled(teamsRes.map((res) => res.json()))
  ).map(({ value }) => value);

  return teamIds;
};

export const setBBDefaults = async () => {
  if (!BLUEBOTTLE_ENABLE) {
    return;
  }

  const defaultMatch = {
    teams: [],
    isCurrent: true,
    seasonId: 1,
    isActive: true,
    type: 1,
    ruleSet: 0,
    onStage: true,
  };

  const defaultShowing = {
    scoreboard: {
      show: false,
      overlaysToDisable: [],
    },
    patch: {
      show: false,
      overlaysToDisable: [],
    },
    tabs: {
      show: false,
      overlaysToDisable: [],
    },
    scoreboardBottom: {
      show: true, // !
      overlaysToDisable: [],
    },
    baronPitTimer: {
      show: true, // !
      overlaysToDisable: [],
    },
    dragonPitTimer: {
      show: true, // !
      overlaysToDisable: [],
    },
    inhibitors: {
      show: false,
      overlaysToDisable: [],
    },
    disabledOverlayIds: [],
  };

  await Promise.allSettled([
    fetch(`${BLUEBOTTLE_ENDPOINT}/api/style/set/active/1/${BLUEBOTTLE_STYLE}`, {
      headers: { "Content-Type": "application/json" },

      method: "POST",
    }),
  ]);

  await resetCurrentGame();

  const teams = await resetTeams();

  await Promise.allSettled([
    fetch(`${BLUEBOTTLE_ENDPOINT}/api/match`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...defaultMatch, teams }),
    }),
  ]);

  await Promise.allSettled([
    fetch(`${BLUEBOTTLE_ENDPOINT}/api/ingame/showing`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(defaultShowing),
    }),
  ]);
};
