import { Controller, Get } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";
import {
  HealthCheckService,
  HealthCheck,
  MikroOrmHealthIndicator,
} from "@nestjs/terminus";

@ApiTags("health")
@Controller("health")
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private db: MikroOrmHealthIndicator,
  ) {}

  @Get("live")
  @HealthCheck()
  @ApiOperation({
    summary: "Liveness probe",
    description: "Checks if the process is running. No external dependencies.",
  })
  @ApiResponse({ status: 200, description: "Process is alive" })
  live() {
    return { status: "ok", timestamp: new Date().toISOString() };
  }

  @Get("ready")
  @HealthCheck()
  @ApiOperation({
    summary: "Readiness probe",
    description:
      "Checks if the service can handle requests (PostgreSQL connectivity).",
  })
  @ApiResponse({ status: 200, description: "Service is ready" })
  @ApiResponse({ status: 503, description: "Service unavailable" })
  ready() {
    return this.health.check([() => this.db.pingCheck("database")]);
  }
}
