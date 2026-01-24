"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RemixModule = void 0;
const common_1 = require("@nestjs/common");
const event_bus_1 = require("../shared/event_bus");
const remix_controller_1 = require("./remix.controller");
const remix_service_1 = require("./remix.service");
let RemixModule = class RemixModule {
};
exports.RemixModule = RemixModule;
exports.RemixModule = RemixModule = __decorate([
    (0, common_1.Module)({
        controllers: [remix_controller_1.RemixController],
        providers: [event_bus_1.EventBus, remix_service_1.RemixService],
    })
], RemixModule);
