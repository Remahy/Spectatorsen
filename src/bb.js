import { fetch } from "undici";
import bbDefaultsObject from "../bbdefaultsObject.cjs";

const { defaultMatch, defaultShowing, defaultTeam1, defaultTeam2 } =
  bbDefaultsObject;

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

export const setBBDefaults = async () => {
  if (!BLUEBOTTLE_ENABLE) {
    return;
  }


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
