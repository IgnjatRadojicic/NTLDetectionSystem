namespace Hack2on.Infrastructure.Sql
{
    public static class OutageQueries
    {
        private const string DataNowExpr = "(SELECT MAX(Ts) FROM [dbo].[MeterReads])";

        public const string TelemetryGapDetection = @"
            DECLARE @DataNow DATETIME = (SELECT MAX(Ts) FROM [dbo].[MeterReads]);

            WITH ReadGaps AS (
                SELECT
                    Mid AS MeterId,
                    Ts AS CurrentReadTime,
                    LAG(Ts) OVER (PARTITION BY Mid ORDER BY Ts) AS PreviousReadTime,
                    DATEDIFF(
                        MINUTE,
                        LAG(Ts) OVER (PARTITION BY Mid ORDER BY Ts),
                        Ts
                    ) AS GapInMinutes
                FROM [dbo].[MeterReads]
                WHERE Ts >= DATEADD(DAY, -7, @DataNow)
            ),
            ValidGaps AS (
                SELECT *
                FROM ReadGaps
                WHERE PreviousReadTime IS NOT NULL
                  AND GapInMinutes > 60
            )
            SELECT
                vg.MeterId,
                vg.PreviousReadTime AS PowerLostTime,
                vg.CurrentReadTime AS PowerRestoredTime,
                vg.GapInMinutes AS OutageDurationMinutes,
                s.Id AS SubstationId,
                f33.Id AS Feeder33Id,
                ts.Id AS TransmissionStationId
            FROM ValidGaps vg
            JOIN [dbo].[Meters] m ON m.Id = vg.MeterId
            JOIN [dbo].[Feeders11] f11 ON f11.MeterId = m.Id
            JOIN [dbo].[Substations] s ON s.Id = f11.SsId
            JOIN [dbo].[Feeders33] f33 ON f33.Id = f11.Feeder33Id
            JOIN [dbo].[TransmissionStations] ts ON ts.Id = f33.TsId
            WHERE
                s.Id IS NOT NULL
                AND f33.Id IS NOT NULL
                AND ts.Id IS NOT NULL
            ORDER BY vg.GapInMinutes DESC;";

        public const string ActiveTelemetryOutages = @"
            DECLARE @DataNow DATETIME = (SELECT MAX(Ts) FROM [dbo].[MeterReads]);

            WITH LastReads AS (
                SELECT
                    mr.Mid AS MeterId,
                    mr.Ts AS LastReadTime,
                    ROW_NUMBER() OVER (PARTITION BY mr.Mid ORDER BY mr.Ts DESC) AS rn
                FROM [dbo].[MeterReads] mr
                WHERE mr.Ts >= DATEADD(DAY, -7, @DataNow)
            )
            SELECT
                lr.MeterId,
                lr.LastReadTime AS DetectedAt,
                DATEDIFF(MINUTE, lr.LastReadTime, @DataNow) AS OutageDurationMinutes
            FROM LastReads lr
            JOIN [dbo].[Feeders11] f11
                ON f11.MeterId = lr.MeterId
            JOIN [dbo].[Substations] s
                ON s.Id = f11.SsId
            JOIN [dbo].[Feeders33] f33
                ON f33.Id = f11.Feeder33Id
            JOIN [dbo].[TransmissionStations] ts
                ON ts.Id = COALESCE(f11.TsId, f33.TsId)
            WHERE lr.rn = 1
              AND DATEDIFF(MINUTE, lr.LastReadTime, @DataNow) > 60
              AND s.Id IS NOT NULL
              AND f33.Id IS NOT NULL
              AND ts.Id IS NOT NULL
            ORDER BY OutageDurationMinutes DESC;";

        public const string Get0OrNullMeterReads = @"
            DECLARE @DataNow DATETIME = (SELECT MAX(Ts) FROM [dbo].[MeterReads]);

            WITH AllStationsMeters AS (
                SELECT 'Distribution Substation' AS StationType, Name AS StationName, MeterId
                FROM [dbo].[DistributionSubstation]
                WHERE MeterId IS NOT NULL

                UNION ALL

                SELECT 'Substation', s.Name, f11.MeterId
                FROM [dbo].[Substations] s
                JOIN [dbo].[Feeders11] f11 ON s.Id = f11.SsId
                WHERE f11.MeterId IS NOT NULL

                UNION ALL

                SELECT 'Transmission Station', ts.Name, f33.MeterId
                FROM [dbo].[TransmissionStations] ts
                JOIN [dbo].[Feeders33] f33 ON ts.Id = f33.TsId
                WHERE f33.MeterId IS NOT NULL
            ),
            LastVoltageReads AS (
                SELECT
                    mr.Mid,
                    mr.Val,
                    mr.Ts,
                    mr.Cid,
                    ROW_NUMBER() OVER (PARTITION BY mr.Mid ORDER BY mr.Ts DESC) AS rn
                FROM [dbo].[MeterReads] mr
                INNER JOIN [dbo].[Channels] c ON c.Id = mr.Cid
                WHERE mr.Ts >= DATEADD(DAY, -7, @DataNow)
                  AND c.Unit = 'V'
            )
            SELECT
                asm.StationType,
                asm.StationName,
                m.Id AS MeterId,
                m.MSN AS MeterSerialNumber,
                lr.Val AS ReadValue,
                lr.Ts AS ReadTimestamp,
                c.Name AS ChannelName,
                c.Unit,
                CASE
                    WHEN lr.Mid IS NULL THEN 'No telemetry'
                    WHEN lr.Val = 0     THEN 'Zero voltage'
                END AS OutageReason
            FROM AllStationsMeters asm
            JOIN [dbo].[Meters] m ON m.Id = asm.MeterId
            LEFT JOIN LastVoltageReads lr ON lr.Mid = m.Id AND lr.rn = 1
            LEFT JOIN [dbo].[Channels] c ON c.Id = lr.Cid
            WHERE lr.Mid IS NULL
               OR lr.Val = 0;";
    }
}