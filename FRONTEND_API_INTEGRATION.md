# Frontend-API Integration Plan

> **Created**: January 13, 2026  
> **Status**: In Progress

---

## 📋 Overview

This document tracks the integration between `ops-web` frontend pages and `ops-api` backend endpoints.

---

## 🗄️ Database Schema Changes (Completed)

### New Columns Added to `admins` Table
| Column | Type | Description |
|--------|------|-------------|
| `team` | TEXT | Team assignment (e.g., '방문 1팀', '방문 2팀') |
| `job_title` | TEXT | Job title (e.g., '사회복지사', '팀장') |
| `phone_number` | TEXT | Staff phone number |
| `max_capacity` | INTEGER | Maximum ward assignment capacity (default: 20) |

### New Table: `ward_assignments`
Staff-to-ward assignment relationships.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `admin_id` | UUID | FK → admins.id |
| `organization_ward_id` | UUID | FK → organization_wards.id |
| `assigned_at` | TIMESTAMP | Assignment timestamp |
| `assigned_by` | UUID | FK → admins.id (nullable) |
| `is_active` | BOOLEAN | Active assignment flag |
| `notes` | TEXT | Optional notes |

---

## 📊 Page-by-Page API Mapping

### 1. Dashboard (`/app/dashboard`)

| Component | Data Needed | API Endpoint | Status |
|-----------|-------------|--------------|--------|
| `DailyOperationsSummary` | totalCalls, incomingCalls, outgoingCalls, duration stats, check-in rate | `GET /v1/admin/dashboard/stats` | ⚠️ Needs frontend wiring |
| `OperationsTimeline` | Hourly call data (scheduled, actual, incoming) | `GET /v1/admin/dashboard/timeline` | ✅ **Implemented** |
| `BulletinBoard` | Bulletin CRUD | `GET/POST/PUT/DELETE /v1/admin/bulletins` | ✅ **Implemented** |
| `EmergencyLog` | Emergency list with status | `GET /v1/admin/emergencies` | ✅ Exists |

### 2. Beneficiaries (`/app/beneficiaries`)

| Feature | API Endpoint | Status |
|---------|--------------|--------|
| List wards | `GET /v1/admin/my-wards` | ✅ Exists |
| Get detail | `GET /v1/admin/beneficiaries/:id` | ✅ Exists |
| Update | `PUT /v1/admin/beneficiaries/:id` | ✅ Exists |
| Delete | `DELETE /v1/admin/beneficiaries/:id` | ✅ Exists |
| Bulk upload | `POST /v1/admin/wards/bulk-upload` | ✅ Exists |

### 3. Stats (`/app/stats`)

| Data | API Endpoint | Status |
|------|--------------|--------|
| Call statistics | `GET /v1/admin/dashboard/stats` | ⚠️ Needs frontend wiring |
| Mood distribution | `GET /v1/admin/dashboard/stats` → `moodDistribution` | ⚠️ Needs frontend wiring |
| Weekly trend | `GET /v1/admin/dashboard/stats` → `weeklyTrend` | ⚠️ Needs frontend wiring |
| Top keywords | `GET /v1/admin/dashboard/stats` → `topKeywords` | ⚠️ Needs frontend wiring |
| Date range filter | Query params on stats endpoint | ❌ **TODO** |

### 4. Staff (`/app/staff`)

| Feature | API Endpoint | Status |
|---------|--------------|--------|
| List staff | `GET /v1/admin/staff` | ✅ **Implemented** |
| Get staff detail | `GET /v1/admin/staff/:id` | ✅ **Implemented** |
| Create staff | `POST /v1/admin/staff` | ✅ **Implemented** |
| Update staff | `PUT /v1/admin/staff/:id` | ✅ **Implemented** |
| Delete staff | `DELETE /v1/admin/staff/:id` | ✅ **Implemented** |
| Get assignments | `GET /v1/admin/staff/:id/assignments` | ✅ **Implemented** |
| Assign ward | `POST /v1/admin/staff/:id/assign` | ✅ **Implemented** |
| Unassign ward | `DELETE /v1/admin/staff/:id/assignments/:assignmentId` | ✅ **Implemented** |
| Staff stats | `GET /v1/admin/staff/stats` | ✅ **Implemented** |
| List teams | `GET /v1/admin/staff/teams` | ✅ **Implemented** |

### 5. Settings (`/app/settings`)

| Feature | API Endpoint | Status |
|---------|--------------|--------|
| Get settings | `GET /v1/admin/settings` | ✅ **Implemented** |
| Save settings | `PUT /v1/admin/settings` | ✅ **Implemented** |

---

## 🎯 Implementation Phases

### Phase 1: Staff API ✅ **COMPLETED**
Staff management controller with full CRUD and assignment features.

**Files created:**
- `src/admin/staff/dto.ts` - DTOs for validation
- `src/admin/staff/staff.service.ts` - Business logic
- `src/admin/staff/staff.controller.ts` - REST endpoints
- `src/admin/staff/index.ts` - Module exports

**Endpoints:**
```
GET    /v1/admin/staff                              - List staff with pagination & filtering
GET    /v1/admin/staff/stats                        - Staff statistics
GET    /v1/admin/staff/teams                        - List unique teams
GET    /v1/admin/staff/:id                          - Staff detail
POST   /v1/admin/staff                              - Create staff member
PUT    /v1/admin/staff/:id                          - Update staff member
DELETE /v1/admin/staff/:id                          - Soft delete staff member
GET    /v1/admin/staff/:id/assignments              - Get assigned wards
POST   /v1/admin/staff/:id/assign                   - Assign ward to staff
DELETE /v1/admin/staff/:id/assignments/:assignmentId - Unassign ward
```

### Phase 2: Dashboard Enhancements ✅ **COMPLETED**
Extend existing dashboard controller.

**Files:**
- `src/admin/dashboard/dashboard.controller.ts` - Added timeline endpoint
- `src/admin/bulletins/dto.ts` - DTOs for validation
- `src/admin/bulletins/bulletins.service.ts` - Business logic
- `src/admin/bulletins/bulletins.controller.ts` - REST endpoints
- `src/admin/bulletins/index.ts` - Module exports

**Endpoints:**
```
GET    /v1/admin/dashboard/timeline  - Hourly call distribution
GET    /v1/admin/bulletins           - List bulletins
GET    /v1/admin/bulletins/:id       - Get bulletin detail
POST   /v1/admin/bulletins           - Create bulletin
PUT    /v1/admin/bulletins/:id       - Update bulletin
DELETE /v1/admin/bulletins/:id       - Delete bulletin
```

### Phase 3: Settings API ✅ **COMPLETED**
Organization settings controller.

**Files:**
- `src/admin/settings/dto.ts` - DTOs for validation
- `src/admin/settings/settings.service.ts` - Business logic
- `src/admin/settings/settings.controller.ts` - REST endpoints
- `src/admin/settings/index.ts` - Exports

**Endpoints:**
```
GET /v1/admin/settings    - Get organization settings
PUT /v1/admin/settings    - Update settings
```

**Frontend wiring:**
- `ops-web/hooks/useSettingsApi.ts` - API hook
- `ops-web/app/settings/page.tsx` - Connected to API with loading states

### Phase 4: Frontend Wiring
Connect existing APIs to frontend components.

---

## ✅ Completed Tasks

- [x] Add staff fields to `admins` table (`team`, `job_title`, `phone_number`, `max_capacity`)
- [x] Create `ward_assignments` table
- [x] Update Prisma schema
- [x] Update `init-db.sql`
- [x] Add seed data for staff
- [x] Rebuild database with new schema
- [x] Generate Prisma types
- [x] Create Staff API controller (`src/admin/staff/staff.controller.ts`)
- [x] Create Staff service (`src/admin/staff/staff.service.ts`)
- [x] Create Staff DTOs (`src/admin/staff/dto.ts`)
- [x] Register Staff module in `admin.module.ts`
- [x] Verify endpoints working in NestJS
- [x] Create `useStaffApi` hook (`ops-web/hooks/useStaffApi.ts`)
- [x] Wire staff page to API (`ops-web/app/staff/page.tsx`)
- [x] Add loading states and team display
- [x] Run verification (`tsc --noEmit`, `prettier --write`)
- [x] Create Settings API endpoints (`src/admin/settings/`)
- [x] Create `useSettingsApi` hook (`ops-web/hooks/useSettingsApi.ts`)
- [x] Wire settings page to API (`ops-web/app/settings/page.tsx`)
- [x] Add loading states to settings page
- [x] Regenerate Prisma client with OrganizationSettings model
- [x] Add dashboard timeline endpoint (`src/admin/dashboard/dashboard.controller.ts`)
- [x] Create Bulletin model in Prisma schema
- [x] Add bulletins table to init-db.sql
- [x] Create Bulletins API controller (`src/admin/bulletins/`)
- [x] Register Bulletins module in `admin.module.ts`

## 🔄 In Progress

- [ ] Wire frontend to existing APIs

## 📝 TODO

- [ ] Wire dashboard components to API (timeline, bulletins)
- [ ] Add date range filtering to stats

---

## 📁 Relevant Files

### Backend (ops-api)
- `prisma/schema.prisma` - Database schema
- `init-db.sql` - Database initialization
- `src/database/seed.service.ts` - Seed data
- `src/admin/staff/` - **NEW** Staff management module
  - `dto.ts` - DTOs for validation
  - `staff.service.ts` - Business logic
  - `staff.controller.ts` - REST endpoints
  - `index.ts` - Exports
- `src/admin/dashboard/dashboard.controller.ts` - Dashboard stats
- `src/admin/beneficiaries/beneficiaries.controller.ts` - Beneficiary CRUD
- `src/admin/emergencies/emergencies.controller.ts` - Emergency management
- `src/admin/wards-management/wards-management.controller.ts` - Ward management
- `src/admin/admin.module.ts` - Admin module (updated with StaffController, SettingsController, BulletinsController)
- `src/admin/settings/` - **Settings management module**
  - `dto.ts` - DTOs for validation
  - `settings.service.ts` - Business logic
  - `settings.controller.ts` - REST endpoints
  - `index.ts` - Exports
- `src/admin/bulletins/` - **Bulletins management module**
  - `dto.ts` - DTOs for validation
  - `bulletins.service.ts` - Business logic
  - `bulletins.controller.ts` - REST endpoints
  - `index.ts` - Exports
- `src/database/repositories/dashboard.repository.ts` - Dashboard queries (added getHourlyCallDistribution)

### Frontend (ops-web)
- `app/dashboard/page.tsx` - Dashboard page
- `app/beneficiaries/page.tsx` - Beneficiaries page
- `app/stats/page.tsx` - Statistics page
- `app/staff/page.tsx` - Staff management page
- `app/settings/page.tsx` - Settings page (connected to API)
- `hooks/useApi.ts` - API hook
- `hooks/useStaffApi.ts` - Staff API hook
- `hooks/useSettingsApi.ts` - Settings API hook
- `lib/api-client.ts` - API client

---

## 🔗 API Base URLs

- **Development**: `http://localhost:8080`
- **Production**: Configured via environment

## 🔐 Authentication

All admin endpoints require:
- Bearer token in `Authorization` header
- Token obtained via `/v1/admin/auth/oauth` (Kakao/Google)
- Refresh via `/v1/admin/auth/refresh`
