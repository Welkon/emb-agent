'use strict';

const ADVANCED_COMMAND_SECTIONS = [
  {
    title: 'Bootstrap and project state',
    entries: [
      'init',
      'config show',
      'config set <key> <value>',
      'config profile list',
      'config profile show <name>',
      'config profile set <name>',
      'config prefs show',
      'config prefs set <key> <value>',
      'config prefs reset',
      'config settings show',
      'config settings set <key> <value>',
      'config settings reset',
      'project show [--effective] [--field <path>]',
      'project set [--confirm] --field <path> --value <json-or-string>'
    ]
  },
  {
    title: 'Truth and document intake',
    entries: [
      'declare hardware [--confirm] [--mcu <name>] [--board <name>] [--target <name>] [--truth <text>] [--constraint <text>] [--unknown <text>] [--source <path>]',
      '  [--signal <name> [--pin <pin>] --dir <direction> [--auto-pin] [--default-state <state>] [--note <text>] [--confirmed <true|false>]]',
      '  [--peripheral <name> --usage <text>]',
      'ingest hardware [--confirm] [--mcu <name>] [--board <name>] [--target <name>] [--truth <text>] [--constraint <text>] [--unknown <text>] [--source <path>]',
      '  [--signal <name> [--pin <pin>] --dir <direction> [--auto-pin] [--default-state <state>] [--note <text>] [--confirmed <true|false>]]',
      '  [--peripheral <name> --usage <text>]',
      'ingest requirements [--confirm] [--goal <text>] [--feature <text>] [--constraint <text>] [--accept <text>] [--failure <text>] [--unknown <text>] [--source <path>]',
      'ingest apply doc <doc-id> [--confirm] --to hardware|requirements [--only field1,field2] [--force]',
      'ingest apply doc <doc-id> --from-last-diff',
      'ingest apply doc <doc-id> --preset <name>',
      'ingest schematic --file <path> [--file <path> ...] [--format auto|altium-json|altium-raw|netlist|bom-csv|text] [--title <text>] [--force]',
      'ingest board --file <path.PcbDoc> [--format auto|altium-pcbdoc] [--title <text>] [--force]',
      'schematic <summary|components|component|nets|net|bom|advice|preview|raw> [--parsed <parsed.json>] [--ref <designator>] [--name <net>] [--record <n>]',
      'board <summary|components|pads|tracks|vias|texts|nets|advice|raw> [--parsed <analysis.board-layout.json>] [--ref <designator>] [--name <net>] [--record <n>]',
      'doc list',
      'doc lookup [--chip <name>] [--vendor <name>] [--package <name>] [--file <schematic>] [--parsed <parsed.json>] [--ref <designator>] [--limit <n>]',
      'doc fetch --url <http(s)-url> [--output <path>] [--confirm]',
      'doc show <doc-id> [--preset <name>] [--apply-ready]',
      'doc diff [--confirm] <doc-id> --to hardware|requirements [--only field1,field2] [--force] [--save-as <name>]',
      'component lookup [--file <schematic>] [--parsed <parsed.json>] [--ref <designator>] [--provider local|szlcsc] [--limit <n>]'
    ]
  },
  {
    title: 'Execution support and closure',
    entries: [
      'status',
      'start',
      'bootstrap [run [--confirm]]',
      'next [run]',
      'pause [note]',
      'pause show',
      'pause clear',
      'resume',
      'resolve',
      'health',
      'update [check]',
      'session show',
      'session history',
      'session show [current|latest|<report-id>]',
      'session record [--confirm] [summary]'
    ]
  },
  {
    title: 'Task, skills, and memory',
    entries: [
      'tool list',
      'tool show <name>',
      'tool run <name> [options]',
      'tool family list',
      'tool family show <slug>',
      'tool device list',
      'tool device show <slug>',
      'chip list',
      'chip show <name>',
      'skills list [--all]',
      'skills show <name>',
      'skills run <name> [--isolated] [input]',
      'skills install [source] [--scope project|user] [--skill <name>] [--force]',
      'skills enable <name>',
      'skills disable <name>',
      'skills remove <name>',
      'capability list [--all]',
      'capability show <name>',
      'capability run <name>',
      'capability materialize [<name>|all] [--force]',
      'executor list',
      'executor show <name>',
      'executor run <name> [--confirm] [-- <args...>]'
    ]
  },
  {
    title: 'Delegation and chip support runtime',
    entries: [
      'support status [<name>]',
      'support source list',
      'support source show <name>',
      'support source add <name> [--confirm] --type path|git --location <path-or-url> [--branch <name>] [--subdir <path>] [--disabled]',
      'support source remove <name> [--confirm]',
      'support bootstrap [<name>] [--confirm] [--type path|git --location <path-or-url>] [--branch <name>] [--subdir <path>] [--to project|runtime] [--force]',
      'support sync <name> [--confirm] [--to project|runtime] [--force]',
      'support sync --all [--confirm] [--to project|runtime] [--force]',
      'adapter analysis init --chip <name> [--model <name>] [--vendor <name>] [--family <slug>] [--device <slug>] [--output <path>] [--force]',
      'adapter derive [--confirm] [--from-project] [--from-doc <doc-id>] [--from-analysis <path>] [--family <slug>] [--device <slug>] [--chip <slug>] [--tool <name>] [--vendor <name>] [--target project|runtime] [--force]',
      'adapter export [<source>] [--confirm] [--chip <slug>] [--device <slug>] [--family <slug>] [--output-root <path>] [--force]',
      'adapter publish [<source>] [--confirm] [--chip <slug>] [--device <slug>] [--family <slug>] [--output-root <path>] [--force]',
      'adapter generate [--confirm] [--from-project] [--from-doc <doc-id>] [--from-analysis <path>] --output-root <path> [--force]'
    ]
  },
  {
    title: 'Task',
    entries: [
      'task list',
      'task show <name>',
      'task add [--confirm] <summary> [--type implement|debug|review|investigate] [--dev-type backend|frontend|fullstack|test|docs|embedded] [--scope <name>] [--package <name>] [--priority P0|P1|P2|P3] [--assignee <name>]',
      'task activate [--confirm] <name>',
      'task resolve [--confirm] <name> [note]',
      'task set-branch [--confirm] <name> <branch>',
      'task set-base-branch [--confirm] <name> <branch>',
      'task subtask add [--confirm] <parent> <child>',
      'task subtask remove [--confirm] <parent> <child>',
      'task create-pr [--confirm] <name> [--dry-run]',
      'task link-pr [--confirm] <name> <url> [--number <id>] [--status <state>]',
      'task context list <name> [implement|check|debug|all]',
      'task context add [--confirm] <name> <implement|check|debug> <path> [reason]',
      'task worktree list',
      'task worktree status [name]',
      'task worktree show <name>',
      'task worktree create [--confirm] <name>',
      'task worktree cleanup [--confirm] [name]',
      'task scope infer <task-name>',
      'task aar help (After Action Review)',
      'task aar scan',
      'task aar record'
    ]
  },
  {
    title: 'Inspection and discovery',
    entries: [
      'context show',
      'context clear',
      'context compress [note]',
      'context focus get',
      'context focus set <text>',
      'context files list',
      'context files add <path>',
      'context files remove <path>',
      'context files clear',
      'context questions list',
      'context questions add <text>',
      'context questions remove <text>',
      'context questions clear',
      'context risks list',
      'context risks add <text>',
      'context risks remove <text>',
      'context risks clear',
      'memory stack',
      'memory list',
      'memory show <entry>',
      'memory remember [--confirm] --type <user|feedback|project|reference> <summary> [--detail <text>]',
      'memory extract [--confirm] [note]',
      'memory audit',
      'memory promote [--confirm] <entry> --to <organization|user|project|local>',
      'knowledge init',
      'knowledge index [--rebuild]',
      'knowledge log [--tail <n>]',
      'knowledge lint',
      'knowledge graph build',
      'knowledge graph update',
      'knowledge graph refresh',
      'knowledge graph report',
      'knowledge graph query <term>',
      'knowledge graph explain <term>',
      'knowledge graph path <from> <to>',
      'knowledge graph lint',
      'knowledge formula draft --from-tool-output <file> [--confirm]',
      'knowledge save-query [--confirm] <title> [--summary <text>] [--body <text>] [--kind <query|decision|risk|chip|peripheral|board>]',
      'knowledge ingest [--confirm] <source-title> [--summary <text>] [--body <text>]',
      'snippet draft [--confirm] --from-tool-output <file> [--title <name>] [--output <path>] [--force]',
      'commands list',
      'commands list --all',
      'commands show <name>'
    ]
  },
  {
    title: 'Actions and records',
    entries: [
      'scan save [--confirm] <target> <summary> [--fact <text>] [--question <text>] [--read <text>]',
      'plan save [--confirm] <summary> [--target <target>] [--risk <text>] [--step <text>] [--verify <text>]',
      'review context',
      'review axes',
      'review save [--confirm] <summary> [--scope <text>] [--finding <text>] [--check <text>]',
      'verify save [--confirm] <summary> [--target <target>] [--check <text>] [--result <text>] [--evidence <text>] [--followup <text>]',
      'verify confirm [--confirm] <name> [note]',
      'verify reject [--confirm] <name> [note]',
      'note targets',
      'note add [--confirm] <target> <summary> [--kind <kind>] [--evidence <text>] [--unverified <text>]'
    ]
  },
  {
    title: 'Transcript recovery',
    entries: [
      'transcript import --provider codex --id <session-id>',
      'transcript import --provider claude|cursor|generic --file <transcript>',
      'transcript analyze --from <transcript-or-analysis-json>',
      'transcript review --from <analysis-json> --reviewed-file <reviewed-analysis-json>',
      'transcript review --from <analysis-json> --accept-heuristic',
      'transcript apply --from <analysis-json> --confirm'
    ]
  },
  {
    title: 'Dispatch and orchestration',
    entries: [
      'dispatch show <action>',
      'dispatch next',
      'dispatch launch [next|<action>]',
      'dispatch collect',
      'dispatch run [next|<action>]',
      'schedule show <action>',
      'orchestrate [next]',
      'orchestrate launch [next|<action>]',
      'orchestrate collect',
      'orchestrate run [next|<action>]',
      'orchestrate show <action>'
    ]
  },
  {
    title: 'Workflow and scaffold authoring',
    entries: [
      'workflow init [--force]',
      'workflow list',
      'workflow import registry <source> [--branch <name>] [--subdir <path>] [--force]',
      'workflow show registry',
      'workflow show <spec|template> <name>',
      'workflow new spec <name> [--with-template [<name>]] [--output <path>] [--force]',
      'workflow new template <name> [--output <path>] [--force]',
      'scaffold list',
      'scaffold show <name>',
      'scaffold install <name> [output] [--force] [KEY=VALUE ...]',
      'spec list',
      'spec show <name>',
      'spec add <name>',
      'spec remove <name>',
      'spec clear',
      'help commands',
      'help agents'
    ]
  },
  {
    title: 'External protocol',
    entries: [
      'external <start|status|next|health|dispatch-next>',
      'external start',
      'external status',
      'external health',
      'external next',
      'external dispatch-next',
      'external init'
    ]
  }
];

function cloneSections(sections) {
  return sections.map(section => ({
    title: section.title,
    entries: section.entries.slice()
  }));
}

function getAdvancedCommandSections() {
  return cloneSections(ADVANCED_COMMAND_SECTIONS);
}

module.exports = {
  ADVANCED_COMMAND_SECTIONS,
  getAdvancedCommandSections
};
