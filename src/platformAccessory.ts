import {
  Service,
  PlatformAccessory,
  Logger,
} from 'homebridge';

import { RinnaiHeaterPlatform } from './platform';
import { RinnaiState, getState, setTargetTemperature } from './rinnaiApi';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class RinnaiHeaterAccessory {
  private statusService: Service;
  private thermostatService: Service;
  private currentState: RinnaiState | null;

  constructor(
    private readonly platform: RinnaiHeaterPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly log: Logger,
  ) {
    this.currentState = null;
    this.log = log;
    this.log.debug('Starting Rinnai Heater!');

    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Rinnai')
      .setCharacteristic(this.platform.Characteristic.Model, 'RinnaiModel')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, 'RinnaiSerial');

    // get the LightBulb service if it exists, otherwise create a new LightBulb service
    // you can create multiple services for each accessory
    this.statusService = this.accessory.getService(this.platform.Service.HeaterCooler)
      || this.accessory.addService(this.platform.Service.HeaterCooler);

    this.thermostatService = this.accessory.getService(this.platform.Service.Thermostat)
      || this.accessory.addService(this.platform.Service.Thermostat);

    this.thermostatService.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
      .setProps({validValues: [
        this.platform.Characteristic.TargetHeatingCoolingState.OFF,
        this.platform.Characteristic.TargetHeatingCoolingState.HEAT,
      ]});

    // set the service name, this is what is displayed as the default name on the Home app
    // in this example we are using the name we stored in the `accessory.context` in the `discoverDevices` method.
    this.thermostatService.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.name);
    this.statusService.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.name);

    this.statusService.getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState)
      .onGet(this.handleCurrentHeatingState.bind(this));

    this.statusService.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(this.handleCurrentTemperatureGet.bind(this));

    this.statusService.getCharacteristic(this.platform.Characteristic.Active)
      .onGet(this.handleCurrentActiveState.bind(this));

    this.thermostatService.getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState)
      .onGet(this.handleCurrentHeatingState.bind(this));

    this.thermostatService.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
      .onGet(() => 1)
      .onSet(this.handleTargetHeatingCoolingStateSet.bind(this));

    this.thermostatService.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(this.handleCurrentTemperatureGet.bind(this))
      .setProps({
        minValue: 35,
        maxValue: 45,
        minStep: 1,
      });

    this.thermostatService.getCharacteristic(this.platform.Characteristic.TargetTemperature)
      .onGet(this.handleCurrentTemperatureGet.bind(this))
      .onSet(this.handleTargetTemperatureSet.bind(this))
      .setProps({
        minValue: 35,
        maxValue: 45,
        minStep: 1,
      });

    this.thermostatService.getCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits)
      .onGet(this.handleTemperatureDisplayUnitsGet.bind(this))
      .onSet(this.handleTemperatureDisplayUnitsSet.bind(this));

    this.pollForStateUpdates();
  }

  async pollForStateUpdates() {
    try {
      const newState = await getState(true);

      if (!this.currentState) {
        this.log.debug('No current state..', this.getCurrentHeatingCoolingState(newState));
        this.statusService.updateCharacteristic(
          this.platform.Characteristic.Active,
          this.getCurrentActiveState(newState),
        );
      } else {
        this.log.debug('had previous state');
        if (newState.isHeating !== this.currentState.isHeating) {
          this.log.debug('it changed!..', this.getCurrentHeatingCoolingState(newState));
          this.statusService.updateCharacteristic(
            this.platform.Characteristic.Active,
            this.getCurrentActiveState(newState),
          );
        }
      }

      this.currentState = newState;
    } catch (e) {
      console.error('Polling failed...', e);
    }

    await new Promise((resolve) => setTimeout(resolve, 3000));

    this.pollForStateUpdates();
  }

  getCurrentHeatingCoolingState(state: RinnaiState) {
    const { isHeating } = state;

    if (isHeating) {
      return this.platform.Characteristic.TargetHeatingCoolingState.HEAT;
    }

    return this.platform.Characteristic.TargetHeatingCoolingState.OFF;
  }

  getCurrentActiveState(state: RinnaiState) {
    const { isHeating } = state;

    this.log.debug('Is heating?', isHeating);
    if (isHeating) {
      return this.platform.Characteristic.Active.ACTIVE;
    }

    return this.platform.Characteristic.Active.INACTIVE;
  }

  async handleCurrentActiveState() {
    const state = await getState();

    return this.getCurrentActiveState(state);
  }

  async handleCurrentHeatingState() {
    const { isHeating } = await getState();

    this.log.debug('Is heating?', isHeating);
    if (isHeating) {
      return this.platform.Characteristic.TargetHeatingCoolingState.HEAT;
    }

    return this.platform.Characteristic.TargetHeatingCoolingState.OFF;
  }

  /**
   * Handle requests to get the current value of the "Current Heating Cooling State" characteristic
   */
  async handleCurrentHeatingCoolingStateGet() {
    const { isPoweredOn } = await getState();
    this.log.debug('Triggered GET CurrentHeatingCoolingState');

    if (isPoweredOn) {
      return this.platform.Characteristic.CurrentHeatingCoolingState.HEAT;
    }

    return this.platform.Characteristic.CurrentHeatingCoolingState.OFF;
  }

  /**
   * Handle requests to set the "Target Heating Cooling State" characteristic
   */
  handleTargetHeatingCoolingStateSet(value) {
    this.log.debug('Triggered SET TargetHeatingCoolingState:', value);
  }

  /**
   * Handle requests to get the current value of the "Current Temperature" characteristic
   */
  async handleCurrentTemperatureGet() {
    this.log.debug('Triggered GET CurrentTemperature');

    const { targetTemperature } = await getState();

    return targetTemperature;
  }

  /**
   * Handle requests to set the "Target Temperature" characteristic
   */
  handleTargetTemperatureSet(value) {
    this.log.debug('Triggered SET TargetTemperature:', value);
    const { targetTemperature } = setTargetTemperature(value);

    return targetTemperature;
  }

  /**
   * Handle requests to get the current value of the "Temperature Display Units" characteristic
   */
  handleTemperatureDisplayUnitsGet() {
    this.log.debug('Triggered GET TemperatureDisplayUnits');

    return this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS;
  }

  /**
   * Handle requests to set the "Temperature Display Units" characteristic
   */
  handleTemperatureDisplayUnitsSet(value: unknown) {
    this.log.debug('Triggered SET TemperatureDisplayUnits:', value);
  }
}
