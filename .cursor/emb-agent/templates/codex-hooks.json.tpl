{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": {{SESSION_START_COMMAND}},
            "timeout": 15,
            "statusMessage": "Loading emb-agent context..."
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Bash|Edit|Write|MultiEdit|Agent|Task",
        "hooks": [
          {
            "type": "command",
            "command": {{POST_TOOL_USE_COMMAND}},
            "timeout": 10
          }
        ]
      }
    ]
  }
}
