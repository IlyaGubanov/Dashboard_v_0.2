import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import type { DirectionKpi, DynamicsPoint, Overview, PeopleView, PeriodItem, SiteCard, SiteKpiRow, TrackersView, WorkGrid } from '@mvs/shared';
import { CurrentUser } from '../auth/decorators';
import type { AuthUser } from '../common/request';
import { KpiService } from './kpi.service';

@Controller()
export class KpiController {
  constructor(private readonly kpi: KpiService) {}

  /** Производственная сводка: показатели всех доступных направлений на последнюю отчётную точку. */
  @Get('overview')
  overview(@CurrentUser() user: AuthUser): Promise<Overview> {
    return this.kpi.overview(user);
  }

  /** Показатели направления; ?date=ГГГГ-ММ-ДД — срез на прошлую дату. */
  @Get('directions/:code/kpi')
  directionKpi(@CurrentUser() user: AuthUser, @Param('code') code: string, @Query('date') date?: string): Promise<DirectionKpi> {
    return this.kpi.kpi(user, code, date);
  }

  /** Реестр объектов с готовностью, планом, отклонением и деньгами на дату. */
  @Get('directions/:code/sites')
  sites(@CurrentUser() user: AuthUser, @Param('code') code: string, @Query('date') date?: string): Promise<SiteKpiRow[]> {
    return this.kpi.sites(user, code, date);
  }

  /** Динамика направления по отчётным точкам до даты. */
  @Get('directions/:code/dynamics')
  dynamics(@CurrentUser() user: AuthUser, @Param('code') code: string, @Query('date') date?: string): Promise<DynamicsPoint[]> {
    return this.kpi.dynamics(user, code, date);
  }

  /** Позиции всех объектов на дату — матрица «объект × вид работ» и график работ. */
  @Get('directions/:code/grid')
  grid(@CurrentUser() user: AuthUser, @Param('code') code: string, @Query('date') date?: string): Promise<WorkGrid> {
    return this.kpi.grid(user, code, date);
  }

  /** Надстройки (закупки, испытания, МГЭ, документация) по всем объектам. */
  @Get('directions/:code/trackers')
  trackers(@CurrentUser() user: AuthUser, @Param('code') code: string): Promise<TrackersView> {
    return this.kpi.trackers(user, code);
  }

  /** Ответственные направления и контроль заполнения. */
  @Get('directions/:code/people')
  people(@CurrentUser() user: AuthUser, @Param('code') code: string): Promise<PeopleView> {
    return this.kpi.people(user, code);
  }

  /** Карточка объекта на дату. */
  @Get('directions/:code/sites/:id')
  site(
    @CurrentUser() user: AuthUser,
    @Param('code') code: string,
    @Param('id', ParseIntPipe) id: number,
    @Query('date') date?: string,
  ): Promise<SiteCard> {
    return this.kpi.siteCard(user, code, id, date);
  }

  /** Отчётные точки направления (новые сверху) — для выбора даты среза. */
  @Get('directions/:code/periods')
  periods(@CurrentUser() user: AuthUser, @Param('code') code: string): Promise<PeriodItem[]> {
    return this.kpi.periods(user, code);
  }
}
