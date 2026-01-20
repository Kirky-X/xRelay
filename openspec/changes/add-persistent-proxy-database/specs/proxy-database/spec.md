## ADDED Requirements

### Requirement: Database Connection Management
The system SHALL support PostgreSQL database connection via DATABASE_URL environment variable.

#### Scenario: Database connection configured
- **GIVEN** DATABASE_URL environment variable is set
- **WHEN** the application starts
- **THEN** the system establishes a connection to PostgreSQL
- **AND** the connection is available for database operations

#### Scenario: Database connection not configured
- **GIVEN** DATABASE_URL environment variable is not set
- **WHEN** the application starts
- **THEN** the system uses in-memory mode
- **AND** the system functions normally without database

#### Scenario: Database connection fails
- **GIVEN** DATABASE_URL environment variable is set but connection fails
- **WHEN** the application starts
- **THEN** the system logs an error
- **AND** the system falls back to in-memory mode
- **AND** the system continues to function

### Requirement: Available Proxies Table
The system SHALL store available proxy information in the `available_proxies` table.

#### Scenario: Insert new proxy
- **GIVEN** the database is connected
- **WHEN** a new proxy is inserted with ip, port, and source
- **THEN** the proxy is stored with default failure_count=0 and success_count=0
- **AND** the created_at and updated_at timestamps are set
- **AND** duplicate ip:port combinations are rejected

#### Scenario: Increment failure count
- **GIVEN** a proxy exists in available_proxies with failure_count=5
- **WHEN** the proxy fails a request
- **THEN** the failure_count is incremented to 6
- **AND** the updated_at timestamp is updated

#### Scenario: Increment success count
- **GIVEN** a proxy exists in available_proxies with success_count=10
- **WHEN** the proxy successfully handles a request
- **THEN** the success_count is incremented to 11
- **AND** the updated_at timestamp is updated

#### Scenario: Query available proxies
- **GIVEN** multiple proxies exist in available_proxies
- **WHEN** querying for available proxies
- **THEN** the system returns all proxies sorted by weight
- **AND** the results include ip, port, failure_count, success_count, and timestamps

### Requirement: Deprecated Proxies Table
The system SHALL store deprecated proxy information in the `deprecated_proxies` table.

#### Scenario: Move proxy to deprecated table
- **GIVEN** a proxy in available_proxies has failure_count >= 10
- **WHEN** the proxy fails another request
- **THEN** the proxy is moved to deprecated_proxies
- **AND** the proxy is removed from available_proxies
- **AND** the deprecated_at timestamp is set

#### Scenario: Insert deprecated proxy directly
- **GIVEN** a proxy fails reachability check
- **WHEN** the proxy is marked as deprecated
- **THEN** the proxy is inserted into deprecated_proxies
- **AND** the failure_count is preserved
- **AND** the deprecated_at timestamp is set

#### Scenario: Query deprecated proxies
- **GIVEN** multiple proxies exist in deprecated_proxies
- **WHEN** querying for deprecated proxies
- **THEN** the system returns all deprecated proxies
- **AND** the results include ip, port, failure_count, and deprecated_at

### Requirement: Proxy Weight Calculation
The system SHALL calculate proxy weight based on success and failure counts.

#### Scenario: Calculate weight for successful proxy
- **GIVEN** a proxy has success_count=20 and failure_count=5
- **WHEN** calculating the proxy weight
- **THEN** the weight is calculated as 20 / (20 + 5 + 1) ≈ 0.769
- **AND** higher weight indicates higher reliability

#### Scenario: Calculate weight for new proxy
- **GIVEN** a proxy has success_count=0 and failure_count=0
- **WHEN** calculating the proxy weight
- **THEN** the weight is calculated as 0 / (0 + 0 + 1) = 0
- **AND** the proxy gets a default weight for initial selection

#### Scenario: Select proxy by weight
- **GIVEN** multiple proxies with different weights exist
- **WHEN** selecting a proxy for use
- **THEN** the system uses weighted random selection
- **AND** proxies with higher weight have higher probability of selection

### Requirement: Multi-Proxy Fallback
The system SHALL select 5 proxies and attempt them sequentially for each request.

#### Scenario: Select 5 proxies
- **GIVEN** the available_proxies table has at least 5 proxies
- **WHEN** preparing for a request
- **THEN** the system selects 5 proxies based on weight
- **AND** the proxies are ordered by weight (highest first)

#### Scenario: Sequential fallback
- **GIVEN** 5 proxies are selected for a request
- **WHEN** the first proxy fails
- **THEN** the system increments the proxy's failure_count
- **AND** the system tries the next proxy
- **AND** this continues until a proxy succeeds or all 5 fail

#### Scenario: Less than 5 proxies available
- **GIVEN** the available_proxies table has only 3 proxies
- **WHEN** preparing for a request
- **THEN** the system selects all 3 available proxies
- **AND** the system logs a warning about low proxy count

### Requirement: Proxy Pool Auto-Refill
The system SHALL automatically fetch new proxies when available proxy count is less than 5.

#### Scenario: Auto-refill triggered
- **GIVEN** the available_proxies table has 4 proxies
- **WHEN** a request is made
- **THEN** the system fetches new proxies from proxy sources
- **AND** the system filters out proxies in deprecated_proxies
- **AND** the system inserts new proxies into available_proxies

#### Scenario: Filter deprecated proxies
- **GIVEN** proxy sources return 20 proxies
- **AND** 5 of them exist in deprecated_proxies
- **WHEN** fetching new proxies
- **THEN** the system only inserts the 15 non-deprecated proxies
- **AND** the 5 deprecated proxies are ignored

### Requirement: Reachability Check
The system SHALL verify proxy reachability before using it.

#### Scenario: Reachable proxy
- **GIVEN** a proxy is selected for use
- **WHEN** the reachability check succeeds
- **THEN** the proxy is used for the request
- **AND** the last_checked_at timestamp is updated

#### Scenario: Unreachable proxy
- **GIVEN** a proxy is selected for use
- **WHEN** the reachability check fails
- **THEN** the proxy is moved to deprecated_proxies
- **AND** the system selects another proxy
- **AND** the process repeats until a reachable proxy is found

#### Scenario: Reachability check timeout
- **GIVEN** a reachability check times out after 3 seconds
- **WHEN** the timeout occurs
- **THEN** the proxy is considered unreachable
- **AND** the proxy is moved to deprecated_proxies

### Requirement: Auto-Cleanup Deprecated Proxies
The system SHALL automatically delete deprecated proxies older than 30 days.

#### Scenario: Scheduled cleanup
- **GIVEN** deprecated_proxies contains proxies deprecated 31 days ago
- **WHEN** the cleanup task runs
- **THEN** proxies older than 30 days are deleted
- **AND** the number of deleted proxies is logged

#### Scenario: Recent deprecated proxies preserved
- **GIVEN** deprecated_proxies contains proxies deprecated 15 days ago
- **WHEN** the cleanup task runs
- **THEN** these proxies are preserved
- **AND** no deletion occurs

#### Scenario: Empty deprecated table
- **GIVEN** deprecated_proxies is empty
- **WHEN** the cleanup task runs
- **THEN** no deletion occurs
- **AND** the task completes successfully

### Requirement: Startup Proxy Loading
The system SHALL load proxies from proxy sources into the database on startup.

#### Scenario: First startup
- **GIVEN** the available_proxies table is empty
- **WHEN** the application starts
- **THEN** the system fetches proxies from all sources
- **AND** the system inserts them into available_proxies
- **AND** the system logs the number of loaded proxies

#### Scenario: Subsequent startup
- **GIVEN** the available_proxies table already has proxies
- **WHEN** the application starts
- **THEN** the system checks if proxy count < 5
- **AND** if count < 5, fetches new proxies
- **AND** if count >= 5, uses existing proxies

#### Scenario: Startup with database unavailable
- **GIVEN** DATABASE_URL is configured but database is unavailable
- **WHEN** the application starts
- **THEN** the system falls back to in-memory mode
- **AND** the system loads proxies into memory
- **AND** the system logs a warning about database unavailability

### Requirement: Database Schema Management
The system SHALL provide database schema migration scripts.

#### Scenario: Initial schema creation
- **GIVEN** the database is empty
- **WHEN** the migration script runs
- **THEN** available_proxies table is created
- **AND** deprecated_proxies table is created
- **AND** all indexes are created
- **AND** the migration is logged

#### Scenario: Schema version tracking
- **GIVEN** migrations have been applied
- **WHEN** querying the schema version
- **THEN** the system returns the current schema version
- **AND** the system can detect if new migrations are needed

#### Scenario: Migration rollback
- **GIVEN** a migration was applied
- **WHEN** rolling back the migration
- **THEN** the schema is reverted to the previous version
- **AND** data is preserved if possible