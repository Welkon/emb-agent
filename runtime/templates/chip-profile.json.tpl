{
  "name": "{{CHIP_NAME}}",
  "vendor": "VendorName",
  "family": "{{FAMILY_NAME}}",
  "sample": false,
  "series": "SeriesName",
  "package": "",
  "architecture": "",
  "runtime_model": "{{RUNTIME_MODEL}}",
  "description": "External chip profile for {{CHIP_NAME}}.",
  "summary": {},
  "capabilities": [],
  "packages": [],
  "pins": {},
  "peripherals": {
    "PERIPHERAL_NAME": {
      "description": "Peripheral description",
      "base_address": "0x0000",
      "instances": [
        {
          "name": "INSTANCE0",
          "pins": ["PA0"]
        }
      ],
      "registers": {
        "REGNAME": {
          "offset": "0x00",
          "description": "Register purpose",
          "access": "R/W",
          "reset_value": "0x00"
        }
      }
    }
  },
  "interrupts": [
    {
      "vector": 0,
      "source": "PeripheralName",
      "flag": "XXIF",
      "enable": "XXIE",
      "priority": null
    }
  ],
  "docs": [],
  "related_tools": [
    "{{TOOL_NAME}}"
  ],
  "source_modules": [],
  "notes": [
    "This chip profile belongs to the project or an external extension, not emb-agent core."
  ]
}
