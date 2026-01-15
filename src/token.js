// Based off of https://github.com/KararTY/BeFriendlier-Shared/blob/master/src/TwitchAuth.ts

/**
 * @typedef {Object} TwitchAuthBody
 * @property {string} access_token
 * @property {string} refresh_token
 * @property {number} expires_in
 * @property {string[]} scope
 * @property {string} token_type
 */

/**
 * @typedef {Object} TwitchValidateBody
 * @property {string} client_id
 * @property {number} expires_in
 * @property {string} login
 * @property {string[]} scope
 * @property {string} user_id
 */

/**
 * @typedef {Object} Config
 * @property {string} clientToken
 * @property {string} clientSecret
 * @property {string} redirectURI
 * @property {string[]} scope
 * @property {Headers} headers
 */

export class TwitchAuth {
  /**
   * @param {Config} config
   */
  constructor(config) {
    this.clientToken = config.clientToken;
    this.clientSecret = config.clientSecret;
    this.redirectURI = config.redirectURI;
    this.scope = config.scope.join("%20");
    this.headers = config.headers;
    this.logger = {
      error: console.error,
    };
  }

  /**
   * @returns {Promise<TwitchAuthBody|null>}
   */
  async requestAppToken() {
    const searchParams = new URLSearchParams({
      client_id: this.clientToken,
      client_secret: this.clientSecret,
      grant_type: "client_credentials",
    });

    try {
      const res = await fetch(
        `https://id.twitch.tv/oauth2/token?${searchParams.toString()}&scope=${
          this.scope
        }`,
        {
          method: "POST",
          headers: { ...this.headers },
        }
      );

      return res.json();
    } catch (err) {
      this.logger.error({ err }, "Twitch.requestAppToken()");
      return null;
    }
  }

  /**
   * @param {string} token
   * @returns {Promise<TwitchAuthBody|null>}
   */
  async refreshToken(token) {
    const searchParams = new URLSearchParams({
      client_id: this.clientToken,
      client_secret: this.clientSecret,
      grant_type: "refresh_token",
      refresh_token: encodeURI(token),
    });

    try {
      const res = await fetch(
        `https://id.twitch.tv/oauth2/token?${searchParams.toString()}&scope=${
          this.scope
        }`,
        {
          method: "POST",
          headers: { ...this.headers },
        }
      );

      return res.json();
    } catch (err) {
      this.logger.error({ err }, "Twitch.refreshToken()");
      return null;
    }
  }

  /**
   * @param {string} token
   * @returns {Promise<TwitchValidateBody|null>}
   */
  async validateToken(token) {
    try {
      const res = await fetch("https://id.twitch.tv/oauth2/validate", {
        headers: {
          ...this.headers,
          "Client-ID": this.clientToken,
          Authorization: `OAuth ${token}`,
        },
      });

      return res.json();
    } catch (err) {
      this.logger.error({ err }, "Twitch.validateToken()");
      return null;
    }
  }
}
