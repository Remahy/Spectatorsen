import { exec, execSync } from "child_process";
import path from "path";
import { fetch } from "undici";

const {
  BLUEBOTTLE_ENABLE,
  BLUEBOTTLE_EXE_PATH,
  BLUEBOTTLE_ENDPOINT,
  BLUEBOTTLE_STYLE,
} = process.env;

const checkBBLaunched = async () => {
  try {
    const isAlive = await fetch(`${BLUEBOTTLE_ENDPOINT}/api/status/version`);

    if (!isAlive.ok) {
      return false;
    }

    const res = await isAlive.json();

    if (typeof res.version === "undefined") {
      return false;
    }
  } catch (err) {
    console.error("BB not running?");
    return false;
  }

  return true;
};

const setMatch = async () => {
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
    fetch(`${BLUEBOTTLE_ENDPOINT}/api/match`, {
      method: "PUT",
      body: JSON.stringify(defaultMatch),
    }),
    fetch(`${BLUEBOTTLE_ENDPOINT}/api/ingame/showing`, {
      method: "PUT",
      body: JSON.stringify(defaultShowing),
    }),
    fetch(`${BLUEBOTTLE_ENDPOINT}/api/style/set/active/1/${BLUEBOTTLE_STYLE}`, {
      method: "POST",
    }),
  ]);
};

export const restartBlueBottle = () => {
  if (!BLUEBOTTLE_ENABLE) {
    return;
  }

  const exeName = path.basename(BLUEBOTTLE_EXE_PATH);

  try {
    execSync(`taskkill /IM "${exeName}" /F`, { stdio: "ignore" });
  } catch {
    // noop
  }

  setTimeout(() => {
    exec(`cmd /c start "" "${BLUEBOTTLE_EXE_PATH}"`);

    const checkIsLaunched = () => {
      return setTimeout(async () => {
        const isLaunched = await checkBBLaunched();
        if (!isLaunched) {
          checkIsLaunched();
          return;
        }

        setMatch();
      }, 1000);
    };

    checkIsLaunched();
  }, 5000);
};
