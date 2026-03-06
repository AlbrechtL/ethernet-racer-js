import "./style.css";

import { RacingScene } from "./game/racing-scene.ts";
import { GlContext } from "./gl/gl-context.ts";
import { MatrixStack } from "./gl/matrix-stack.ts";
import { Matrices } from "./math/matrices.ts";
import { Settings } from "./settings.ts";
import { GameState } from "./game/game-state.ts";
import { GameContext } from "./game/game-context.ts";
import { Time } from "./util/time.ts";
import { KeyInput } from "./input/key-input.ts";
import { TouchInput } from "./input/touch-input.ts";
import { CourseConfig, CourseConfigs } from "./game/course/course-configs.ts";
import { Environment, Environments } from "./game/environment/environments.ts";
import { Hud } from "./hud.ts";
import { RemoteMeshDescriptor } from "./game/character/remote-mesh.ts";
import { RuntimeConfig } from "./game/runtime-config.ts";

const courseConfig = getCourseConfigFromUrl();
const environment = getEnvironmentFromUrl();
const runtimeConfig = getRuntimeConfigFromUrl();

const canvas: HTMLCanvasElement = document.getElementById(
  "game-canvas",
) as HTMLCanvasElement;
const gl: WebGL2RenderingContext = canvas.getContext(
  "webgl2",
) as WebGL2RenderingContext;

GlContext.gl = gl;
GlContext.modelViewMatrix = new MatrixStack();

const hud = new Hud();

const keyInput = new KeyInput();
const touchInput = new TouchInput();

const racingScene = new RacingScene();
await racingScene.init(courseConfig, environment, runtimeConfig);

hideLoadingScreen();

let lastFrameTime = 0;
requestAnimationFrame(renderFrame);

function renderFrame(time: number): void {
  if (lastFrameTime !== 0) {
    const timeStep = time - lastFrameTime;

    resizeCanvas();

    racingScene.update(
      timeStep / Time.ONE_SECOND_IN_MILLISECONDS,
      keyInput.keyState,
      touchInput.touchState,
    );

    touchInput.draw();

    hud.updateHud();

    if (GameContext.state === GameState.TERMINATED) {
      onGameTerminated();
      return;
    }
  }

  lastFrameTime = time;
  requestAnimationFrame(renderFrame);
}

function resizeCanvas(): void {
  const dpr = window.devicePixelRatio;
  const { width, height } = canvas.getBoundingClientRect();
  const displayWidth = Math.round(width * dpr);
  const displayHeight = Math.round(height * dpr);

  const needsResize =
    canvas.width != displayWidth || canvas.height != displayHeight;

  if (needsResize) {
    canvas.width = displayWidth;
    canvas.height = displayHeight;

    gl.viewport(0, 0, canvas.width, canvas.height);

    GlContext.perspectiveMatrix = Matrices.createPerspectiveMatrix(
      Settings.FIELD_OF_VIEW,
      canvas.width / canvas.height,
      Settings.NEAR_CLIPPING_DISTANCE,
      Settings.FAR_CLIPPING_DISTANCE + Settings.FAR_CLIPPING_FUDGE_AMOUNT,
    );
  }
}

function getCourseConfigFromUrl(): CourseConfig {
  const urlParams = new URLSearchParams(window.location.search);
  const course = urlParams.get("course");
  if (!course || !CourseConfigs.BY_KEY.has(course)) {
    return CourseConfigs.BUNNY_HILL;
  }
  return CourseConfigs.BY_KEY.get(course) as CourseConfig;
}

function getEnvironmentFromUrl(): Environment {
  const urlParams = new URLSearchParams(window.location.search);
  const environment = urlParams.get("environment");
  if (!environment || !Environments.BY_KEY.has(environment)) {
    return Environments.SUNNY;
  }
  return Environments.BY_KEY.get(environment) as Environment
}

function getRuntimeConfigFromUrl(): RuntimeConfig {
  return {
    switchMesh: getSwitchMeshFromUrl(),
  };
}

function getSwitchMeshFromUrl(): RemoteMeshDescriptor | undefined {
  const urlParams = new URLSearchParams(window.location.search);
  const meshUrl = urlParams.get("switchMeshUrl");
  if (!meshUrl) {
    return undefined;
  }

  return {
    url: meshUrl,
    scale: getVector3FromUrl(urlParams, "switchMeshScale") ?? [1.15, 1.15, 1.15],
    rotation: getVector3FromUrl(urlParams, "switchMeshRotation") ?? [0, 0, 0],
    translation: getVector3FromUrl(urlParams, "switchMeshTranslation") ?? [0, 0, 0],
    diffuseColor: getVector3FromUrl(urlParams, "switchMeshDiffuseColor"),
    specularColor: getVector3FromUrl(urlParams, "switchMeshSpecularColor"),
    specularExponent: getNumberFromUrl(urlParams, "switchMeshSpecularExponent"),
  };
}

function getVector3FromUrl(
  urlParams: URLSearchParams,
  parameterName: string,
): [number, number, number] | undefined {
  const rawValue = urlParams.get(parameterName);
  if (!rawValue) {
    return undefined;
  }

  const values = rawValue.split(",").map((value) => Number.parseFloat(value));
  if (values.length !== 3 || values.some((value) => !Number.isFinite(value))) {
    console.warn(`Ignoring invalid ${parameterName} value: ${rawValue}`);
    return undefined;
  }

  return [values[0], values[1], values[2]];
}

function getNumberFromUrl(
  urlParams: URLSearchParams,
  parameterName: string,
): number | undefined {
  const rawValue = urlParams.get(parameterName);
  if (!rawValue) {
    return undefined;
  }

  const parsedValue = Number.parseFloat(rawValue);
  if (!Number.isFinite(parsedValue)) {
    console.warn(`Ignoring invalid ${parameterName} value: ${rawValue}`);
    return undefined;
  }

  return parsedValue;
}

function hideLoadingScreen(): void {
  const loadingScreenElement = document.getElementById(
    "loading-screen",
  ) as HTMLDivElement;

  loadingScreenElement.classList.add("faded-out");
  setTimeout(() => loadingScreenElement.classList.add("hidden"), 300);
}

function onGameTerminated(aborted = false): void {
  const hasMenu = new URLSearchParams(window.location.search).has("menu");
  if (hasMenu) {
    let queryParameter = "";
    if (!aborted) {
      const time = (GameContext.endTime ?? 0) - (GameContext.startTime ?? 0);
      const result = btoa(JSON.stringify({ course: GameContext.courseConfig.key, time }));
      queryParameter = "?result=" + encodeURIComponent(result);
    }

    setTimeout(() => (window.location.href = `../index.html${queryParameter}#/practise`), 500);
  } else {
    const courseIndex = Math.floor(CourseConfigs.ALL.length * Math.random());
    const courseKey = CourseConfigs.ALL[courseIndex].key;

    const environmentIndex = Math.floor(Environments.ALL.length * Math.random());
    const environmentKey = Environments.ALL[environmentIndex].key;

    const nextCourseUrl = new URL(window.location.href);
    nextCourseUrl.searchParams.set("course", courseKey);
    nextCourseUrl.searchParams.set("environment", environmentKey);

    setTimeout(() => (window.location.href = nextCourseUrl.toString()), 500);
  }
}

document.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  if (key === "escape") {
    onGameTerminated(true);
  } else if (key === "r") {
    window.location.reload();
  }
});
