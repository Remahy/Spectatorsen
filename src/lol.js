import { fetch, Agent } from "undici";

const agent = new Agent({
  connect: {
    rejectUnauthorized: false,
  },
});

export const getAllGameData = async () => {
  try {
    const res = await fetch(
      "https://127.0.0.1:2999/liveclientdata/allgamedata",
      {
        dispatcher: agent,
        signal: AbortSignal.timeout(5000),
      },
    );

    if (!res.ok) {
      return {};
    }

    return res.json();
  } catch (err) {
    if (err.name === "TimeoutError") {
      throw err;
    }

    return {};
  }
};

export const changeRender = async (renderSettings) => {
  try {
    const res = await fetch("https://127.0.0.1:2999/replay/render", {
      dispatcher: agent,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(renderSettings),
    });

    return res;
  } catch (err) {
    console.error("Something went wrong changing render.");
  }
};

export const checkIsInReplay = async () => {
	try {
		const isInReplay = await fetch("https://127.0.0.1:2999/replay/game", {
			dispatcher: agent,
		});

		if (!isInReplay.ok) {
			return false;
		}

		const res = await isInReplay.json();

		if (typeof res.processID === "undefined") {
			return false;
		}
	} catch (err) {
		console.error("Client not live?");
		return false;
	}

	return true;
};

