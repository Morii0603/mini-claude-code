import { BaseTool } from "../types.js";
import type { ToolDef } from "../types.js";

export class GetWeatherTool extends BaseTool {
  def: ToolDef = {
    name: "get_weather",
    description: "获取指定城市的当前天气",
    input_schema: {
      type: "object",
      properties: {
        city: {
          type: "string",
          description: "城市名称，例如：北京",
        },
        unit: {
          type: "string",
          enum: ["celsius", "fahrenheit"],
          description: "温度单位",
        },
      },
      required: ["city"],
    },
  };

  async run(input: Record<string, unknown>): Promise<string> {
    const city = input.city as string;
    const unit = (input.unit as string) || "celsius";
    const temp = unit === "fahrenheit" ? "77°F" : "25°C";
    return `The weather in ${city} is sunny with a temperature of ${temp}.`;
  }
}
