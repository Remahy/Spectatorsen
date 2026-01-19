import { exec, execSync } from "child_process";
import path from "path";
import { fetch } from "undici";
import bbDefaultsObject from "../bbdefaultsObject.cjs";

const { defaultMatch, defaultShowing, defaultTeam1, defaultTeam2 } =
  bbDefaultsObject;

const {
  BLUEBOTTLE_ENABLE,
  BLUEBOTTLE_EXECUTABLE,
  BLUEBOTTLE_ENDPOINT,
  BLUEBOTTLE_STYLE,
} = process.env;

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

export const waitForBB = async () => {
  if (!BLUEBOTTLE_ENABLE) {
    return;
  }

  while (true) {
    try {
      const res = await fetch(`${BLUEBOTTLE_ENDPOINT}/api/status/version`);

      if (res.status === 200) {
        return;
      }
    } catch {
      // noop
    }

    await new Promise((r) => setTimeout(r, 500));
  }
};

const changeShowing = (showing) => {
  return fetch(`${BLUEBOTTLE_ENDPOINT}/api/ingame/showing`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(showing),
  });
};

export const showChart = async (chartNames) => {
  if (!BLUEBOTTLE_ENABLE) {
    return;
  }

  const showing = {};

  for (let index = 0; index < chartNames.length; index += 1) {
    const chartName = chartNames[index];
    showing[chartName] = {
      show: true,
      timePeriod: 0,
      overlaysToDisable: [],
    };
  }

  await Promise.allSettled([changeShowing(showing)]);

  setTimeout(async () => {
    const hiding = {};

    for (let index = 0; index < chartNames.length; index += 1) {
      const chartName = chartNames[index];
      hiding[chartName] = {
        timePeriod: 0,
        show: false,
        overlaysToDisable: [],
      };
    }

    await Promise.allSettled([changeShowing(hiding)]);
  }, 29_000);
};

const restartBB = async () => {
  try {
    const exeName = path.basename(BLUEBOTTLE_EXECUTABLE);

    execSync(`taskkill /IM "${exeName}" /F`, { stdio: "ignore" });
  } catch {
    // noop
  }

  const directory = path.dirname(BLUEBOTTLE_EXECUTABLE);

  setTimeout(() => {
    exec(`cmd /c start "" /D "${directory}" "${BLUEBOTTLE_EXECUTABLE}"`);
  }, 10_000);

  return waitForBB();
};

const resetTeams = async () => {
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
        }),
      ),
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
    await Promise.allSettled(teamsRes.map((res) => res?.json()))
  ).map(({ value }) => value);

  return teamIds;
};

let initializing = false;
export const setBBDefaults = async () => {
  if (!BLUEBOTTLE_ENABLE) {
    return;
  }

  if (initializing) {
    return;
  }

  initializing = true;

  await restartBB();

  await Promise.allSettled([
    fetch(`${BLUEBOTTLE_ENDPOINT}/api/style/set/active/1/${BLUEBOTTLE_STYLE}`, {
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
    fetch(`${BLUEBOTTLE_ENDPOINT}/api/style/set/active/2/${BLUEBOTTLE_STYLE}`, {
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
  ]);

  const teams = await resetTeams();

  await Promise.allSettled([
    fetch(`${BLUEBOTTLE_ENDPOINT}/api/match`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...defaultMatch, teams }),
    }),
  ]);

  await Promise.allSettled([changeShowing(defaultShowing)]);

  initializing = false;
};
