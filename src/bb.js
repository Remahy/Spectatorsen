import { fetch } from "undici";

const {
  BLUEBOTTLE_ENABLE,
  BLUEBOTTLE_ENDPOINT,
  BLUEBOTTLE_STYLE,
} = process.env;

export const setBBDefaults = async () => {
  if (!BLUEBOTTLE_ENABLE) {
    return;
  }

  const defaultMatch = {
    name: "",
    type: 1,
    teams: [1, 2],
    isCurrent: true,
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

  await Promise.allSettled([
    fetch(`${BLUEBOTTLE_ENDPOINT}/api/match`, {
      method: "PUT",
      body: JSON.stringify(defaultMatch),
    }),
  ]);

  await Promise.allSettled([
    fetch(`${BLUEBOTTLE_ENDPOINT}/api/ingame/showing`, {
      method: "PUT",
      body: JSON.stringify(defaultShowing),
    }),
  ]);
};
