import { OBSWebSocket } from "obs-websocket-js";

const { OBS_IP, OBS_PORT, OBS_PASSWORD, OBS_BROWSER_SOURCE } = process.env;

const obs = new OBSWebSocket();

export const refreshBrowserSourceCache = async () => {
  if (!OBS_IP) {
    return;
  }

  try {
    await obs.call("PressInputPropertiesButton", {
      inputName: OBS_BROWSER_SOURCE,
      propertyName: "refreshnocache",
    });
    console.log("Refreshed OBS browser source cache");
  } catch (err) {
    console.error("Failed to refresh OBS browser source cache", err);
  }
};

(async () => {
  if (OBS_IP) {
    obs.on("ConnectionOpened", () => console.log("OBS READY"));
    await obs.connect(`ws://${OBS_IP}:${OBS_PORT}`, OBS_PASSWORD);

    refreshBrowserSourceCache();
  } else {
    console.log("OBS refresh browser source cache disabled.");
  }
})();
