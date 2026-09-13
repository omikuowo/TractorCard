/*!
 * 拖拉机大赛 网页版 — 对局传输层（为后续联机模式预留）
 * Copyright (c) 2026 TractorCard Project. All rights reserved. 版权所有，保留一切权利。
 *
 * 单机模式下所有动作都在本地引擎中直接结算。联机模式只需实现同样的接口：
 * 把玩家动作发往服务器，并把服务器广播的动作回放给本地引擎即可，
 * 界面层与规则引擎无需改动。
 */

/** 一次可被回放的动作。type 取值见 ACTIONS。 */
export const ACTIONS = ['declare', 'bury', 'play', 'pass-declare'];

export class Transport {
  /** @param {(action:object)=>void} onAction 收到（本地或远端产生的）动作时回调 */
  constructor(onAction) { this.onAction = onAction; }
  /** 本地玩家产生一个动作。 */
  send(action) { throw new Error('not implemented'); }
  /** 本地座位号；联机时由服务器分配。 */
  get seat() { return 0; }
  close() {}
}

/** 单机传输：动作直接回环，由本地引擎与 AI 结算。 */
export class LocalTransport extends Transport {
  constructor(onAction, seat = 0) { super(onAction); this._seat = seat; }
  get seat() { return this._seat; }
  send(action) { this.onAction({ ...action, local: true }); }
}

/**
 * 联机传输占位实现。后续接入服务器时，把 WebSocket 收到的
 * 动作交给 onAction 即可；协议建议沿用 { type, seat, cards|option } 结构。
 */
export class RemoteTransport extends Transport {
  constructor(onAction, url, room) {
    super(onAction);
    this.url = url; this.room = room; this._seat = null;
    throw new Error('联机模式尚未开放');
  }
}
