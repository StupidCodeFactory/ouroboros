module DashboardHelpers
  def stub_dashboard_gaps(symbol, months)
    stub_request(:get, %r{/v1/gaps\?symbol=#{symbol}}).to_return(status: 200, body: { months: months }.to_json)
  end
end

RSpec.configure { |config| config.include DashboardHelpers }
