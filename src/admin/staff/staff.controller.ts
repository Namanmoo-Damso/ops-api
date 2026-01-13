import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  HttpStatus,
  HttpException,
  Logger,
} from '@nestjs/common';
import { AdminOrganizationGuard } from '../../common/guards/admin-organization.guard';
import { StaffService } from './staff.service';
import {
  ListStaffQueryDto,
  CreateStaffDto,
  UpdateStaffDto,
  AssignWardDto,
  ListAssignmentsQueryDto,
} from './dto';

@Controller('v1/admin/staff')
@UseGuards(AdminOrganizationGuard)
export class StaffController {
  private readonly logger = new Logger(StaffController.name);

  constructor(private readonly staffService: StaffService) {}

  /**
   * GET /v1/admin/staff
   * List all staff members in the organization with pagination
   */
  @Get()
  async listStaff(@Request() req: any, @Query() query: ListStaffQueryDto) {
    const organizationId = req.organizationId;
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const result = await this.staffService.listStaff({
      organizationId,
      search: query.search,
      team: query.team,
      page,
      pageSize,
    });

    return {
      data: result.data,
      pagination: {
        page,
        pageSize,
        total: result.total,
        totalPages: Math.ceil(result.total / pageSize),
      },
    };
  }

  /**
   * GET /v1/admin/staff/stats
   * Get staff statistics for the organization
   */
  @Get('stats')
  async getStats(@Request() req: any) {
    const organizationId = req.organizationId;
    return this.staffService.getStaffStats(organizationId);
  }

  /**
   * GET /v1/admin/staff/teams
   * Get list of unique teams in the organization
   */
  @Get('teams')
  async getTeams(@Request() req: any) {
    const organizationId = req.organizationId;
    const teams = await this.staffService.getTeams(organizationId);
    return { teams };
  }

  /**
   * GET /v1/admin/staff/:id
   * Get detailed information about a specific staff member
   */
  @Get(':id')
  async getStaff(@Request() req: any, @Param('id') staffId: string) {
    const organizationId = req.organizationId;
    const staff = await this.staffService.getStaffDetail(
      organizationId,
      staffId,
    );

    if (!staff) {
      throw new HttpException('Staff not found', HttpStatus.NOT_FOUND);
    }

    return staff;
  }

  /**
   * POST /v1/admin/staff
   * Create a new staff member
   */
  @Post()
  async createStaff(@Request() req: any, @Body() dto: CreateStaffDto) {
    const organizationId = req.organizationId;

    try {
      const result = await this.staffService.createStaff({
        organizationId,
        email: dto.email,
        name: dto.name,
        phoneNumber: dto.phoneNumber,
        team: dto.team,
        jobTitle: dto.jobTitle,
        maxCapacity: dto.maxCapacity,
      });

      return {
        id: result.id,
        message: 'Staff member created successfully',
      };
    } catch (error: any) {
      if (error.code === 'P2002') {
        throw new HttpException(
          'A staff member with this email already exists',
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }
  }

  /**
   * PUT /v1/admin/staff/:id
   * Update a staff member
   */
  @Put(':id')
  async updateStaff(
    @Request() req: any,
    @Param('id') staffId: string,
    @Body() dto: UpdateStaffDto,
  ) {
    const organizationId = req.organizationId;

    const success = await this.staffService.updateStaff(
      organizationId,
      staffId,
      dto,
    );

    if (!success) {
      throw new HttpException('Staff not found', HttpStatus.NOT_FOUND);
    }

    return { message: 'Staff member updated successfully' };
  }

  /**
   * DELETE /v1/admin/staff/:id
   * Delete (soft-delete) a staff member
   */
  @Delete(':id')
  async deleteStaff(@Request() req: any, @Param('id') staffId: string) {
    const organizationId = req.organizationId;

    const success = await this.staffService.deleteStaff(
      organizationId,
      staffId,
    );

    if (!success) {
      throw new HttpException('Staff not found', HttpStatus.NOT_FOUND);
    }

    return { message: 'Staff member deleted successfully' };
  }

  /**
   * GET /v1/admin/staff/:id/assignments
   * Get all ward assignments for a staff member
   */
  @Get(':id/assignments')
  async getAssignments(
    @Request() req: any,
    @Param('id') staffId: string,
    @Query() query: ListAssignmentsQueryDto,
  ) {
    const organizationId = req.organizationId;
    const activeOnly = query.activeOnly !== false;

    const assignments = await this.staffService.getStaffAssignments(
      organizationId,
      staffId,
      activeOnly,
    );

    return { data: assignments };
  }

  /**
   * POST /v1/admin/staff/:id/assign
   * Assign a ward to a staff member
   */
  @Post(':id/assign')
  async assignWard(
    @Request() req: any,
    @Param('id') staffId: string,
    @Body() dto: AssignWardDto,
  ) {
    const organizationId = req.organizationId;
    const assignedById = req.admin?.id;

    const result = await this.staffService.assignWard({
      organizationId,
      staffId,
      organizationWardId: dto.organizationWardId,
      assignedById,
      notes: dto.notes,
    });

    if (!result) {
      throw new HttpException(
        'Staff or ward not found in this organization',
        HttpStatus.NOT_FOUND,
      );
    }

    return {
      id: result.id,
      message: 'Ward assigned successfully',
    };
  }

  /**
   * DELETE /v1/admin/staff/:id/assignments/:assignmentId
   * Remove a ward assignment from a staff member
   */
  @Delete(':id/assignments/:assignmentId')
  async unassignWard(
    @Request() req: any,
    @Param('id') staffId: string,
    @Param('assignmentId') assignmentId: string,
  ) {
    const organizationId = req.organizationId;

    const success = await this.staffService.unassignWard(
      organizationId,
      staffId,
      assignmentId,
    );

    if (!success) {
      throw new HttpException('Assignment not found', HttpStatus.NOT_FOUND);
    }

    return { message: 'Ward unassigned successfully' };
  }
}
