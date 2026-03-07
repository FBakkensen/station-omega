/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as actions_generateImage from "../actions/generateImage.js";
import type * as actions_generateStation from "../actions/generateStation.js";
import type * as actions_streamTurn from "../actions/streamTurn.js";
import type * as actions_ttsProxy from "../actions/ttsProxy.js";
import type * as choiceSets from "../choiceSets.js";
import type * as games from "../games.js";
import type * as generationProgress from "../generationProgress.js";
import type * as http from "../http.js";
import type * as lib_serialization from "../lib/serialization.js";
import type * as messages from "../messages.js";
import type * as runHistory from "../runHistory.js";
import type * as stationGeneration from "../stationGeneration.js";
import type * as stationImages from "../stationImages.js";
import type * as stations from "../stations.js";
import type * as test_utils from "../test_utils.js";
import type * as turnLocks from "../turnLocks.js";
import type * as turnSegments from "../turnSegments.js";
import type * as turns from "../turns.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "actions/generateImage": typeof actions_generateImage;
  "actions/generateStation": typeof actions_generateStation;
  "actions/streamTurn": typeof actions_streamTurn;
  "actions/ttsProxy": typeof actions_ttsProxy;
  choiceSets: typeof choiceSets;
  games: typeof games;
  generationProgress: typeof generationProgress;
  http: typeof http;
  "lib/serialization": typeof lib_serialization;
  messages: typeof messages;
  runHistory: typeof runHistory;
  stationGeneration: typeof stationGeneration;
  stationImages: typeof stationImages;
  stations: typeof stations;
  test_utils: typeof test_utils;
  turnLocks: typeof turnLocks;
  turnSegments: typeof turnSegments;
  turns: typeof turns;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
