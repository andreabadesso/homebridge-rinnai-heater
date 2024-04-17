import { parseTargetTemperatureToRange, parseRinnaiTemperature, delay, round } from './utils';
import axios from 'axios';

export interface RinnaiState {
  targetTemperature: number | null;
  isHeating: boolean;
  isPoweredOn: boolean;
}

const options = {
  device: {
    host: '10.69.1.50',
  },
};

const rinnaiApi = axios.create({
  baseURL: `http://${options.device.host}`,
});

let lastState: RinnaiState | null = null;

export const setTargetTemperature = async (target: number, retries = 0, lastTargetTemp?: number | null) => {
  try {
    const targetTemperatureInRange = parseTargetTemperatureToRange(target);
    if (!targetTemperatureInRange) {
      throw new Error('Could not find a target temperature for the requested value.');
    }

    let currentTargetTemp = lastTargetTemp ? +lastTargetTemp : null;

    if (!lastTargetTemp) {
      const { targetTemperature: stateTargetTemp } = await getState(true);
      console.log('Had no last target temp, got it from state:', stateTargetTemp);
      currentTargetTemp = stateTargetTemp;
    }

    if (!currentTargetTemp) {
      throw new Error('Could not get current target temp from state, fail.');
    }

    if (targetTemperatureInRange === currentTargetTemp) {
      console.log('The target temperature is already the current tempeature. Return.');

      return lastState;
    }

    const operation = currentTargetTemp > targetTemperatureInRange ? 'dec' : 'inc';
    const response = await rinnaiApi(operation);
    const parsedParams = parseStateParams(response.data);

    lastState = parsedParams;
    currentTargetTemp = parsedParams.targetTemperature;

    // We reached the target temperature, stop calling the increase API
    if (targetTemperatureInRange === currentTargetTemp) {
      console.log('Successfully set temperature!');

      return lastState;
    }

    await delay(100);

    console.log('Not yet on req tempetaure.', currentTargetTemp, targetTemperatureInRange);

    return setTargetTemperature(target, 0, currentTargetTemp);
  } catch (e: unknown) {
    if (retries < 5) {
      return setTargetTemperature(target, retries + 1, lastTargetTemp);
    }
    console.log('[RINNAI API] set temperature error', e);

    throw new Error('Max number of retries reached.');
  }
};

export const setPowerState = async (turnOn: boolean) => {
  const { isPoweredOn } = await getState();

  if (isPoweredOn === turnOn) {
    return true;
  }

  const response = await rinnaiApi('/lig');

  const state = parseStateParams(response.data);
  lastState = state;

  return lastState;
};


export const pressButton = async (button) => {
  const response = await rinnaiApi(button);

  const params = parseStateParams(response.data);

  lastState = params;
  return params;
};

export const parseStateParams = (stringifiedParams: string): RinnaiState => {
  const params = stringifiedParams.split(',');
  const temperature = parseInt(params[7], 10);
  const targetTemperature = parseRinnaiTemperature(temperature);

  const isHeating = params[2] === '1';
  // const priorityIp = params[6].split(':')[0];
  const isPoweredOn = params[0] !== '11';

  return {
    targetTemperature,
    isHeating,
    isPoweredOn,
  };
};


export const getState = async (ignoreCache = false) => {
  console.log('[RINNAI API] fetching heater state');
  if (lastState && !ignoreCache) {
    console.debug('returning last state');
    return lastState;
  }

  const response = await rinnaiApi('tela_');
  lastState = parseStateParams(response.data);

  console.log('Got response!');
  return lastState;
};

export const getIdentifier = async () => {
  const response = await rinnaiApi('connect');

  return response.data;
};

export const getDeviceParams = async () => {
  console.log('[RINNAI API] fetching heater parameters');

  const response = await rinnaiApi('bus');
  const params = response.data.split(',');

  const targetTemperature = parseRinnaiTemperature(params[18]);
  const inletTemperature = +params[10] / 100;
  const outletTemperature = +params[11] / 100;
  const currentPowerInKCal = +params[9] / 100;
  const powerInkW = round(currentPowerInKCal * 0.014330754);
  const isPoweredOn = params[0] !== '11';

  const waterFlow = round(+params[12] / 100);
  const workingTime = +params[4];

  return {
    targetTemperature,
    inletTemperature,
    outletTemperature,
    powerInkW,
    isPoweredOn,
    waterFlow,
    workingTime,
  };
};

export const getConsumption = async () => {
  const response = await rinnaiApi('consumo');
  const params = response.data.split(',');
  const [minutes, seconds] = params[0].split(':');
  const workingTime = (+minutes * 60) + +seconds;
  const water = round(+params[1] / 1000);
  const gas = round(+params[2] / 9400);

  return { water, gas, workingTime };
};
