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
    }),
  ]);
};

export const resetTeams = async () => {
  const defaultTeam1 = {
    members: [],
    name: "Blue",
    tag: "BLUE",
    isActive: true,
    primaryColor: "#FFFFFFFF",
    secondaryColor: "#FFFFFFFF",
    tertiaryColor: "#FFFFFFFF",
    backgroundColor: "#FF000000",
  };

  const defaultTeam2 = {
    members: [],
    name: "Red",
    tag: "RED",
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

  return (
    await Promise.allSettled([
      fetch(`${BLUEBOTTLE_ENDPOINT}/api/team`, {
        method: "POST",
        body: JSON.stringify(defaultTeam1),
      }),
      fetch(`${BLUEBOTTLE_ENDPOINT}/api/team`, {
        method: "POST",
        body: JSON.stringify(defaultTeam2),
      }),
    ])
  ).map(({ value }) => value);
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
    onStage: false,
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
      method: "POST",
    }),
  ]);

  await resetCurrentGame();

  const teams = await resetTeams();

  await Promise.allSettled([
    fetch(`${BLUEBOTTLE_ENDPOINT}/api/match`, {
      method: "PUT",
      body: JSON.stringify({ ...defaultMatch, teams }),
    }),
  ]);

  await Promise.allSettled([
    fetch(`${BLUEBOTTLE_ENDPOINT}/api/ingame/showing`, {
      method: "PUT",
      body: JSON.stringify(defaultShowing),
    }),
  ]);
};
