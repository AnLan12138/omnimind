# Changelog

All notable changes to OmniMind are documented in this file.

## [0.2.0] - 2025-06-12

### Added
- AI Agent with tool calling, Chain-of-Thought reasoning, and streaming
- RAG knowledge base for network device commands
- Device fingerprinting (vendor, model, OS detection)
- AI skill system (Cisco Expert, Huawei Expert, Troubleshooter roles)
- Right sidebar with AI, Skills, Knowledge, Automation panels
- Custom frameless title bar
- Session sync via GitHub Gist
- Command templates panel
- Automation panel

### Changed
- Full UI overhaul with Tailwind CSS
- Complete Chinese/English i18n coverage
- Telnet protocol refactored with full RFC 854 implementation
- Session sidebar redesigned with folder organization

### Fixed
- Telnet echo loss on split/broadcast mode
- Global xterm pool to survive React remounts on mode switch
- Confirmation dialog required for all delete operations

## [0.1.0] - 2025-05

### Added
- Initial release
- SSH client with tunnel, proxy jump, and agent forwarding
- Telnet client
- RDP client (via forked grdp library)
- VNC client (pure Go RFB implementation)
- FTP/SFTP client with transfer queue and resume
- MOSH client (UDP-based state sync)
- Serial port client
- Session management with SQLite storage and AES-256-GCM encrypted passwords
- Tabbed interface with split and broadcast modes
- Quick connect bar
- Macro recording and playback
- Connection monitoring
- Terminal keyword highlighting
- Native Windows save file dialog
- Import from MobaXterm and SSH config
- SSH key generation
- Auto-reconnect with exponential backoff
- Auto-update checker (GitHub Releases API)
