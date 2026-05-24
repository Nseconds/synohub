CREATE TABLE IF NOT EXISTS synohub_fleet_records (
    RecordID VARCHAR(20) PRIMARY KEY,
    Type ENUM('LeadRegistration', 'ServiceTicket') NOT NULL,
    CustomerOrEntity VARCHAR(100) NOT NULL,
    ContactPerson VARCHAR(80) NOT NULL,
    Phone VARCHAR(20) NOT NULL,
    Email VARCHAR(100) NOT NULL,
    Region ENUM('Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Fujairah', 'Ras Al Khaimah', 'Umm Al Quwain') NOT NULL,
    Status VARCHAR(20) NOT NULL,
    Quantity INT NOT NULL,
    ValueOrAmount DECIMAL(12,2) NOT NULL,
    SalesPersonOrAssignee VARCHAR(30) NOT NULL,
    ImplementationOrDescription TEXT NOT NULL,
    CreatedAt DATETIME NOT NULL
);

INSERT INTO synohub_fleet_records (RecordID, Type, CustomerOrEntity, ContactPerson, Phone, Email, Region, Status, Quantity, ValueOrAmount, SalesPersonOrAssignee, ImplementationOrDescription, CreatedAt) VALUES
('LD-10001','LeadRegistration','Al Futtaim Logistics','Fatima Hassan','+971534744854','fatima.has@alfuttaimlogistics.ae','Abu Dhabi','Proposed',91,102080.00,'Rashid','LOCATOR','2026-04-19 01:01:00'),
('TKT-H629903','ServiceTicket','Ajman Fleet Solutions','Noor Ahmed','+971584335942','noor.ahmed@ajmanfleetsolutions.ae','Ras Al Khaimah','Cancelled',15,30239.00,'Suhail','GPS unit offline troubleshoot','2026-01-02 05:44:00'),
('LD-10002','LeadRegistration','Emirates Freight','Layla Khan','+971536647119','layla.khan@emiratesfreight.ae','Dubai','Proposed',53,17676.00,'Ameen','FLEET DASHCAM','2026-03-09 01:46:00'),
('LD-10003','LeadRegistration','Gulf Cargo LLC','Mohammed Rashid','+971515918715','mohammed.r@gulfcargo.ae','Umm Al Quwain','Completed',78,30203.00,'Feros','LOCATOR','2026-02-28 09:05:00'),
('LD-10004','LeadRegistration','Gulf Cargo LLC','Mohammed Rashid','+971548606962','mohammed.r@gulfcargo.ae','Ras Al Khaimah','Completed',25,53520.00,'Ameen','LOCATOR+ASATEEL','2026-03-10 22:59:00');
