require "date"

module App
  class GapSourcePlanner
    def initialize(clock)
      @clock = clock
    end

    def current_month
      today = Date.today
      today.year * 100 + today.month
    end

    def plan(from)
      (from..current_month).select { |month| (1..12).cover?(month % 100) }
    end
  end
end
