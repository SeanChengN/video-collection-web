class ApiMaintenanceHandlersMixin:
    def list_db_backups_handler(self, data, method='GET'):
        try:
            database_status = 'ok'
            upgrade_diagnostics = self.dependencies.get_database_upgrade_diagnostics()
            try:
                self.dependencies.check_database_connection()
            except Exception as e:
                database_status = 'error'
                self.dependencies.logger.warning("Maintenance database probe failed: %s", e)

            if not self.dependencies.access_token_required():
                return self.dependencies.jsonify({
                    "success": True,
                    "maintenance_enabled": False,
                    "database_status": database_status,
                    "scheduled_backup": self.dependencies.get_scheduled_backup_status(),
                    "backups": [],
                    **upgrade_diagnostics
                })

            return self.dependencies.jsonify({
                "success": True,
                "maintenance_enabled": True,
                "database_status": database_status,
                "scheduled_backup": self.dependencies.get_scheduled_backup_status(),
                "backups": self.dependencies.list_database_backups(),
                **upgrade_diagnostics
            })
        except Exception as e:
            return self.dependencies.json_exception('List database backups', e, '备份列表读取失败')

    def create_db_backup_handler(self, data, method='POST'):
        if not self.dependencies.backup_feature_enabled():
            return self.dependencies.jsonify({"success": False, "message": "请先配置 APP_ACCESS_TOKEN 后再使用备份功能"}), 403

        if not self.dependencies.db_maintenance_lock.acquire(blocking=False):
            return self.dependencies.jsonify({"success": False, "message": "已有数据库维护任务正在执行，请稍后再试"}), 409

        try:
            backup = self.dependencies.run_database_backup()
            return self.dependencies.jsonify({
                "success": True,
                "message": "完整备份已创建",
                "backup": backup,
                "backups": self.dependencies.list_database_backups()
            })
        except FileNotFoundError as e:
            self.dependencies.log_exception('Create database backup', e)
            return self.dependencies.json_error('数据库备份工具不可用，请确认容器已安装 mariadb-client', 500)
        except self.dependencies.database_upgrade_required_error as e:
            self.dependencies.logger.warning("Create database backup requires MariaDB upgrade: %s", e)
            return self.dependencies.jsonify({
                "success": False,
                "message": str(e),
                "database_upgrade_required": True,
                "database_upgrade_command": self.dependencies.database_upgrade_command_hint()
            }), 500
        except Exception as e:
            return self.dependencies.json_exception('Create database backup', e, '数据库备份失败')
        finally:
            self.dependencies.db_maintenance_lock.release()

    def restore_db_backup_handler(self, data, method='POST'):
        if not self.dependencies.backup_feature_enabled():
            return self.dependencies.jsonify({"success": False, "message": "请先配置 APP_ACCESS_TOKEN 后再使用恢复功能"}), 403

        data = data or {}
        filename = self.dependencies.safe_backup_filename(data.get('filename', ''))
        confirm = bool(data.get('confirm'))
        if not filename:
            return self.dependencies.jsonify({"success": False, "message": "备份文件名无效"}), 400
        if not confirm:
            return self.dependencies.jsonify({"success": False, "message": "请确认后再执行恢复"}), 400
        if not self.dependencies.get_backup_file_path(filename, must_exist=True):
            return self.dependencies.jsonify({"success": False, "message": "备份文件不存在"}), 404

        if not self.dependencies.db_maintenance_lock.acquire(blocking=False):
            return self.dependencies.jsonify({"success": False, "message": "已有数据库维护任务正在执行，请稍后再试"}), 409

        try:
            pre_restore_backup = self.dependencies.run_database_backup(prefix='pre_restore_')
            restore_result = self.dependencies.run_backup_restore(filename)
            return self.dependencies.jsonify({
                "success": True,
                "message": "备份恢复已完成",
                "pre_restore_backup": pre_restore_backup,
                "restored_backup": restore_result
            })
        except FileNotFoundError as e:
            self.dependencies.log_exception('Restore database backup', e)
            return self.dependencies.json_error('数据库恢复工具或备份文件不可用', 500)
        except self.dependencies.database_upgrade_required_error as e:
            self.dependencies.logger.warning("Restore pre-backup requires MariaDB upgrade: %s", e)
            return self.dependencies.jsonify({
                "success": False,
                "message": str(e),
                "database_upgrade_required": True,
                "database_upgrade_command": self.dependencies.database_upgrade_command_hint()
            }), 500
        except Exception as e:
            return self.dependencies.json_exception('Restore database backup', e, '数据库恢复失败')
        finally:
            self.dependencies.db_maintenance_lock.release()

    def delete_db_backup_handler(self, data, method='DELETE'):
        if not self.dependencies.backup_feature_enabled():
            return self.dependencies.jsonify({"success": False, "message": "请先配置 APP_ACCESS_TOKEN 后再使用备份删除功能"}), 403

        data = data or {}
        filename = self.dependencies.safe_backup_filename(data.get('filename', ''))
        confirm = bool(data.get('confirm'))
        if not filename:
            return self.dependencies.jsonify({"success": False, "message": "备份文件名无效"}), 400
        if not confirm:
            return self.dependencies.jsonify({"success": False, "message": "请确认后再删除备份"}), 400

        if not self.dependencies.db_maintenance_lock.acquire(blocking=False):
            return self.dependencies.jsonify({"success": False, "message": "已有数据库维护任务正在执行，请稍后再试"}), 409

        try:
            deleted_filename = self.dependencies.delete_database_backup_file(filename)
            return self.dependencies.jsonify({
                "success": True,
                "message": "备份文件已删除",
                "deleted_filename": deleted_filename,
                "backups": self.dependencies.list_database_backups()
            })
        except FileNotFoundError:
            return self.dependencies.jsonify({"success": False, "message": "备份文件不存在"}), 404
        except ValueError:
            return self.dependencies.jsonify({"success": False, "message": "备份文件名无效"}), 400
        except Exception as e:
            return self.dependencies.json_exception('Delete database backup', e, '备份删除失败')
        finally:
            self.dependencies.db_maintenance_lock.release()

    # 图片文件验证
